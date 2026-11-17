/**
 * Fleet health: one cheap command per server, run a few at a time.
 *
 * Used by the panel's overview, by the Host's background health cache, and by
 * the `ssh_monitor` tool — so an agent can ask "is production healthy" and get
 * numbers instead of a wall of free text.
 */
import { exec, acquire } from './ssh.js';

/**
 * One round trip, one line per fact. Everything is sourced from files or
 * commands present on a base install; anything missing simply yields an empty
 * value rather than an error.
 */
const PROBE = [
  'echo "platform=$(uname -sr 2>/dev/null | head -c 60)"',
  'echo "kernel=$(uname -r 2>/dev/null | head -c 40)"',
  'echo "load=$(cut -d\' \' -f1-3 /proc/loadavg 2>/dev/null)"',
  'echo "cores=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"',
  'echo "mem=$(free -m 2>/dev/null | awk \'/^Mem:/{print $3"/"$2}\')"',
  'echo "swap=$(free -m 2>/dev/null | awk \'/^Swap:/{print $3"/"$2}\')"',
  'echo "disk=$(df -P / 2>/dev/null | awk \'NR==2{print $5}\')"',
  'echo "disks=$(df -P 2>/dev/null | awk \'NR>1 && $5+0>=70 {print $6"="$5}\' | head -6 | tr \'\\n\' \',\')"',
  'echo "up=$(cut -d. -f1 /proc/uptime 2>/dev/null)"',
  'echo "procs=$(ps -e --no-headers 2>/dev/null | wc -l)"',
  'echo "failed=$(systemctl --failed --no-legend 2>/dev/null | wc -l)"',
  'echo "failedNames=$(systemctl --failed --no-legend --plain 2>/dev/null | awk \'{print $1}\' | head -8 | tr \'\\n\' \' \')"',
  'echo "docker=$(docker ps -q 2>/dev/null | wc -l)"',
  'echo "listen=$( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | tail -n +2 | wc -l)"',
  'echo "users=$(who 2>/dev/null | wc -l)"',
  'echo "tz=$(date +%Z 2>/dev/null)"',
].join('; ');

function ratio(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (match === null) return { used: null, total: null, percent: null };
  const used = Number(match[1]);
  const total = Number(match[2]);
  return { used, total, percent: total === 0 ? null : Math.round((used / total) * 100) };
}

function parse(stdout) {
  const values = {};
  for (const line of String(stdout).split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  const memory = ratio(values.mem ?? '');
  const swap = ratio(values.swap ?? '');
  const diskMatch = /^(\d+)%$/.exec(values.disk ?? '');
  const cores = values.cores === undefined || values.cores === '' ? null : Number(values.cores);
  const loadRaw = (values.load ?? '').split(/\s+/).filter(Boolean);
  const load1 = loadRaw.length > 0 ? Number(loadRaw[0]) : null;
  const hotDisks = (values.disks ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('='))
    .map((entry) => {
      const [mount, percent] = entry.split('=');
      return { mount, percent: Number(String(percent).replace('%', '')) };
    });

  return {
    platform: values.platform ?? '',
    kernel: values.kernel ?? '',
    load: values.load ?? '',
    load1,
    // Load normalised by core count is the honest CPU-pressure number we can
    // get in one round trip without sampling /proc/stat twice.
    loadPercent: load1 === null || cores === null || cores === 0 ? null : Math.round((load1 / cores) * 100),
    cores,
    memUsedMb: memory.used,
    memTotalMb: memory.total,
    memPercent: memory.percent,
    swapPercent: swap.percent,
    diskPercent: diskMatch === null ? null : Number(diskMatch[1]),
    hotDisks,
    uptimeSec: values.up === undefined || values.up === '' ? null : Number(values.up),
    processes: values.procs === undefined || values.procs === '' ? null : Number(values.procs),
    failedUnits: values.failed === undefined || values.failed === '' ? null : Number(values.failed),
    failedNames: (values.failedNames ?? '').split(/\s+/).filter(Boolean),
    dockerRunning: values.docker === undefined || values.docker === '' ? null : Number(values.docker),
    listeningPorts: values.listen === undefined || values.listen === '' ? null : Number(values.listen),
    loggedIn: values.users === undefined || values.users === '' ? null : Number(values.users),
    timezone: values.tz ?? '',
  };
}

/** A single server's health; never throws. */
export async function monitorOne(server, store, timeoutMs = 15000) {  const started = Date.now();
  try {
    const result = await exec(server, PROBE, { store, timeoutMs });
    return {
      serverId: server.id,
      server: server.name,
      group: server.group,
      ok: result.exitCode === 0,
      latencyMs: Date.now() - started,
      ...parse(result.stdout),
    };
  } catch (error) {
    return {
      serverId: server.id,
      server: server.name,
      group: server.group,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Probe many servers with bounded concurrency. */
export async function monitorMany(servers, store, options = {}) {
  const concurrency = Math.min(8, Math.max(1, Number(options.concurrency) || 4));
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const results = new Array(servers.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= servers.length) return;
      results[index] = await monitorOne(servers[index], store, timeoutMs);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, servers.length || 1) }, worker));
  return results;
}

/** One line per server, for a tool result. */
export function renderMonitorRow(row) {
  if (row.ok !== true) return `${String(row.server).padEnd(18)} ✗ ${row.error ?? 'unreachable'}`;
  if (row.mode === 'connect') {
    return `${String(row.server).padEnd(18)} ✓ ${String(row.latencyMs).padStart(5)}ms  connection ok`;
  }
  const parts = [];
  if (row.load !== '') parts.push(`load ${row.load}`);
  if (row.memPercent !== null) parts.push(`mem ${row.memPercent}%`);
  if (row.diskPercent !== null) parts.push(`disk ${row.diskPercent}%`);
  if (row.failedUnits) parts.push(`${row.failedUnits} failed unit`);
  if (row.uptimeSec !== null) parts.push(`up ${Math.floor(row.uptimeSec / 86400)}d`);
  return `${String(row.server).padEnd(18)} ✓ ${String(row.latencyMs).padStart(5)}ms  ${parts.join(' · ')}`;
}

/**
 * Liveness without executing anything on the host.
 *
 * This is the default monitoring mode: it opens (or reuses) the SSH session and
 * reports reachability plus handshake latency. Not one byte of shell command
 * reaches the machine. The only trace is the login itself in the remote
 * auth log.
 */
export async function connectOne(server, store) {
  const started = Date.now();
  try {
    await acquire(server, store);
    return {
      serverId: server.id,
      server: server.name,
      group: server.group,
      ok: true,
      latencyMs: Date.now() - started,
      mode: 'connect',
    };
  } catch (error) {
    return {
      serverId: server.id,
      server: server.name,
      group: server.group,
      ok: false,
      latencyMs: Date.now() - started,
      mode: 'connect',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Probe many servers for liveness only. */
export async function connectMany(servers, store, options = {}) {
  const concurrency = Math.min(8, Math.max(1, Number(options.concurrency) || 4));
  const results = new Array(servers.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= servers.length) return;
      results[index] = await connectOne(servers[index], store);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, servers.length || 1) }, worker));
  return results;
}

/** Panel severity for one health row: what the status dot should be. */
export function severityOf(row) {
  if (row === null || row === undefined) return 'idle';
  if (row.ok !== true) return 'crit';
  const disk = row.diskPercent ?? 0;
  const mem = row.memPercent ?? 0;
  const load = row.loadPercent ?? 0;
  if (disk >= 92 || mem >= 95 || (row.failedUnits ?? 0) > 0) return 'crit';
  if (disk >= 80 || mem >= 85 || load >= 100) return 'warn';
  return 'ok';
}
