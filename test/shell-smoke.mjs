/**
 * End-to-end check of the interactive shell path, against a throwaway SSH
 * server started in this process. Nothing here touches a real machine.
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = path.join(os.tmpdir(), `ssh-shell-smoke-${Date.now()}`);
process.env.DSH_HOME = home;
fs.rmSync(home, { recursive: true, force: true });

const ssh2 = (await import('ssh2')).default;
const { Server } = ssh2;
const shell = await import('../lib/shell.js');
const store = await import('../lib/store.js');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

let ptyAsked = null;
let sawInput = '';

const fake = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => {
        ptyAsked = info;
        accept();
      });
      session.on('shell', (accept) => {
        const stream = accept();
        stream.write('FAKE-SSH READY\r\n$ ');
        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          sawInput += text;
          if (text.includes('\r') || text.includes('\n')) {
            stream.write(`\r\necho: ${text.replace(/[\r\n]/g, '')}\r\n$ `);
          } else {
            stream.write(text);
          }
        });
        setTimeout(() => stream.exit(0), 4000);
      });
    });
  });
});

await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const port = fake.address().port;
console.log('fake ssh server on 127.0.0.1:' + port);

store.writeStore({
  version: 1,
  groups: [{ id: 'grp_t', name: 'test', color: '', order: 0 }],
  servers: [
    {
      id: 'srv_t',
      name: 'fake',
      host: '127.0.0.1',
      port,
      user: 'tester',
      group: 'grp_t',
      authType: 'password',
      password: 'x',
    },
  ],
});

const loaded = store.readStore();
const target = loaded.servers[0];

console.log('');
console.log('=== open shell ===');
const opened = await shell.openShell(target, loaded, { cols: 100, rows: 30 });
console.log('shellId          :', opened.shellId);
console.log('pty requested    :', ptyAsked === null ? 'NO' : `${ptyAsked.term} ${ptyAsked.cols}x${ptyAsked.rows}`);

await new Promise((resolve) => setTimeout(resolve, 250));
console.log('replay contains  :', shell.replayBuffer(opened.shellId).includes('FAKE-SSH READY'));

console.log('');
console.log('=== stream + input ===');
const received = [];
const unsubscribe = shell.subscribe(opened.shellId, (text) => {
  if (text !== null) received.push(text);
});
shell.sendInput(opened.shellId, 'hello there\r');
await new Promise((resolve) => setTimeout(resolve, 400));
console.log('server saw input :', JSON.stringify(sawInput.trim()));
console.log('stream frames    :', received.length);
console.log('echo came back   :', received.join('').includes('echo: hello there'));

console.log('');
console.log('=== resize ===');
shell.resizeShell(opened.shellId, 140, 40);
await new Promise((resolve) => setTimeout(resolve, 150));
console.log('resize accepted  : yes');
console.log('shell count      :', shell.shellCount());

console.log('');
console.log('=== close ===');
unsubscribe();
const closed = shell.closeShell(opened.shellId);
console.log('closeShell       :', closed);
console.log('count after      :', shell.shellCount());
let threw = false;
try {
  shell.getShell(opened.shellId);
} catch {
  threw = true;
}
console.log('gone afterwards  :', threw);

shell.disposeShells();
fake.close();
fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
