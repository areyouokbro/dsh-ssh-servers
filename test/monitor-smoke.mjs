/**
 * Proves the monitoring guarantees, against a fake SSH server in this process:
 *
 *   connect mode  -> zero exec requests reach the host
 *   metrics mode  -> exactly one, and it is the fixed read-only probe
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = path.join(os.tmpdir(), `ssh-monitor-smoke-${Date.now()}`);
process.env.DSH_HOME = home;
fs.rmSync(home, { recursive: true, force: true });

const { Server } = (await import('ssh2')).default;
const monitor = await import('../lib/monitor.js');
const store = await import('../lib/store.js');
const ssh = await import('../lib/ssh.js');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const commands = [];
let shells = 0;

const fake = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (accept, _reject, info) => {
        commands.push(info.command);
        const stream = accept();
        stream.write('platform=Linux fake\nload=0.10 0.10 0.10\ncores=2\nmem=100/1000\n');
        stream.exit(0);
        stream.end();
      });
      session.on('shell', (accept) => {
        shells += 1;
        accept().end();
      });
    });
  });
});

await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const port = fake.address().port;
console.log('fake ssh server on 127.0.0.1:' + port);

store.writeStore({
  version: 1,
  groups: [{ id: 'grp_m', name: 'mon', color: '', order: 0 }],
  servers: [
    {
      id: 'srv_m',
      name: 'fake',
      host: '127.0.0.1',
      port,
      user: 'tester',
      group: 'grp_m',
      authType: 'password',
      password: 'x',
    },
  ],
});

const loaded = store.readStore();
const target = loaded.servers[0];

console.log('');
console.log('=== connect mode: no command may reach the host ===');
const before = commands.length;
const liveness = await monitor.connectOne(target, loaded);
console.log('ok               :', liveness.ok);
console.log('mode             :', liveness.mode);
console.log('latency          :', liveness.latencyMs + 'ms');
console.log('commands executed:', commands.length - before, commands.length - before === 0 ? '(zero — as promised)' : '(LEAK!)');

console.log('');
console.log('=== connect mode again: still nothing ===');
await monitor.connectOne(target, loaded);
console.log('commands executed:', commands.length - before, commands.length - before === 0 ? '(still zero)' : '(LEAK!)');
console.log('shells opened    :', shells, shells === 0 ? '(none)' : '(unexpected)');

console.log('');
console.log('=== metrics mode: exactly one read-only probe ===');
const afterLiveness = commands.length;
const metrics = await monitor.monitorOne(target, loaded);
const ran = commands.length - afterLiveness;
console.log('ok               :', metrics.ok);
console.log('commands executed:', ran);
console.log('is one probe     :', ran === 1);
if (ran > 0) {
  const text = commands[commands.length - 1];
  const writes = /\b(rm|mkfs|dd|shutdown|reboot|systemctl\s+(start|stop|restart|enable|disable)|kill|chmod|chown|mv|cp|tee|truncate)\b/.exec(text);
  console.log('probe is read-only:', writes === null ? 'yes (no write verb found)' : `NO — found "${writes[0]}"`);
  console.log('probe reads      :', (text.match(/(cat|cut|awk|free|df|ps|wc|uname|date|ss|who|nproc)\b/g) ?? []).slice(0, 12).join(' '));
}

console.log('');
console.log('=== severity mapping ===');
for (const row of [
  null,
  { ok: false },
  { ok: true, diskPercent: 50, memPercent: 40, loadPercent: 20 },
  { ok: true, diskPercent: 85, memPercent: 40, loadPercent: 20 },
  { ok: true, diskPercent: 95, memPercent: 40, loadPercent: 20 },
  { ok: true, diskPercent: 20, memPercent: 20, loadPercent: 20, failedUnits: 2 },
]) {
  console.log(`  ${JSON.stringify(row)} -> ${monitor.severityOf(row)}`);
}

ssh.dispose();
fake.close();
fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
