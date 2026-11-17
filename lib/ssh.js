/**
 * SSH transport: a small connection pool over ssh2, plus exec and SFTP
 * helpers. Both the Host routes and the MCP server go through this module, so
 * a command typed in the panel and a command issued by the agent share one
 * set of pooled connections.
 */
import ssh2 from 'ssh2';
import { findServer, resolveAuth } from './store.js';

const { Client } = ssh2;

const IDLE_MS = 10 * 60 * 1000;
const MAX_BUFFER = 4 * 1024 * 1024;

/** serverId -> { client, ready, lastUsed, stamp } */
const pool = new Map();

let sweeper = null;
function ensureSweeper() {
  if (sweeper !== null) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pool) {
      if (now - entry.lastUsed <= IDLE_MS) continue;
      pool.delete(id);
      try {
        entry.client.end();
      } catch {
        /* already gone */
      }
    }
    if (pool.size === 0 && sweeper !== null) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, 60 * 1000);
  if (typeof sweeper.unref === 'function') sweeper.unref();
}

function forget(serverId) {
  const entry = pool.get(serverId);
  if (entry === undefined) return;
  pool.delete(serverId);
  try {
    entry.client.end();
  } catch {
    /* already gone */
  }
}

function openClient(server, auth, sock) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* nothing to close */
      }
      reject(
        new Error(
          `${server.name} (${server.user}@${server.host}:${server.port}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    };
    client.once('error', fail);
    client.once('ready', () => {
      if (settled) return;
      settled = true;
      client.removeListener('error', fail);
      // A connection that dies later must leave the pool, not linger as a zombie.
      client.on('error', () => forget(server.id));
      client.on('close', () => forget(server.id));
      resolve(client);
    });
    try {
      client.connect({
        host: server.host,
        port: server.port,
        username: server.user,
        ...auth,
        ...(sock === undefined ? {} : { sock }),
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function connectThroughJump(server, store, depth) {
  const jumpServer = findServer(store, server.jump);
  if (jumpServer.id === server.id) throw new Error(`${server.name}: a server cannot jump through itself`);
  if (depth > 3) throw new Error(`${server.name}: jump chain is too deep`);
  const jumpClient = await acquire(jumpServer, store, depth + 1);
  const stream = await new Promise((resolve, reject) => {
    jumpClient.forwardOut('127.0.0.1', 0, server.host, server.port, (error, channel) => {
      if (error) reject(new Error(`${server.name}: jump host ${jumpServer.name} refused: ${error.message}`));
      else resolve(channel);
    });
  });
  return openClient(server, resolveAuth(server), stream);
}

/**
 * Get a live pooled client for a server, opening one if needed.
 * `server.updatedAt` is part of the pool key so editing credentials reconnects.
 */
export async function acquire(server, store, depth = 0) {
  const entry = pool.get(server.id);
  if (entry !== undefined && entry.stamp === server.updatedAt) {
    entry.lastUsed = Date.now();
    return entry.ready;
  }
  if (entry !== undefined) forget(server.id);

  const stamp = server.updatedAt;
  const ready = server.jump === ''
    ? openClient(server, resolveAuth(server))
    : connectThroughJump(server, store, depth);
  const created = { client: null, ready, lastUsed: Date.now(), stamp };
  pool.set(server.id, created);
  try {
    created.client = await ready;
    return created.client;
  } catch (error) {
    pool.delete(server.id);
    throw error;
  }
}

export function poolSize() {
  return pool.size;
}

/** Close every pooled connection; the plugin calls this on unload. */
export function dispose() {
  if (sweeper !== null) {
    clearInterval(sweeper);
    sweeper = null;
  }
  for (const id of [...pool.keys()]) forget(id);
}

function clip(text) {
  if (text.length <= MAX_BUFFER) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_BUFFER)}\n…[truncated]`, truncated: true };
}

/**
 * Run one command. Resolves with stdout/stderr/exit code even for a non-zero
 * exit; only transport failures reject.
 */
export async function exec(server, command, options = {}) {
  const { store, timeoutMs = 120000 } = options;
  if (typeof command !== 'string' || command.trim() === '') throw new Error('command is required');
  const client = await acquire(server, store);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      // A hung command must not poison the pooled connection.
      forget(server.id);
      finish(reject, new Error(`${server.name}: command timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    client.exec(command, (error, stream) => {
      if (error) {
        forget(server.id);
        finish(reject, new Error(`${server.name}: ${error.message}`));
        return;
      }
      const out = [];
      const err = [];
      stream.on('data', (chunk) => out.push(chunk));
      stream.stderr.on('data', (chunk) => err.push(chunk));
      stream.on('close', (code, signal) => {
        const stdout = clip(Buffer.concat(out).toString('utf8'));
        const stderr = clip(Buffer.concat(err).toString('utf8'));
        finish(resolve, {
          server: server.name,
          serverId: server.id,
          command,
          exitCode: typeof code === 'number' ? code : null,
          signal: signal === undefined ? null : signal,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.truncated || stderr.truncated,
          durationMs: Date.now() - started,
        });
      });
      stream.on('error', (streamError) => {
        forget(server.id);
        finish(reject, new Error(`${server.name}: ${streamError.message}`));
      });
    });
  });
}

/** Collect a quick health snapshot: latency, kernel, load, disk. */
export async function probe(server, store) {
  const started = Date.now();
  const result = await exec(
    server,
    'uname -sr 2>/dev/null || ver; echo "---"; (uptime 2>/dev/null || true); echo "---"; (df -h / 2>/dev/null | tail -n 1 || true)',
    { store, timeoutMs: 20000 },
  );
  const [uname = '', uptime = '', disk = ''] = result.stdout.split('---').map((part) => part.trim());
  return {
    ok: result.exitCode === 0,
    server: server.name,
    latencyMs: Date.now() - started,
    platform: uname.split('\n')[0] ?? '',
    uptime,
    disk,
    exitCode: result.exitCode,
  };
}

/** `~` and '' mean the login directory; SFTP starts there. */
function remotePath(input) {
  const value = String(input ?? '').trim();
  if (value === '' || value === '~' || value === '.') return '.';
  if (value.startsWith('~/')) return `./${value.slice(2)}`;
  return value;
}

async function withSftp(server, store, work) {
  const client = await acquire(server, store);
  const sftp = await new Promise((resolve, reject) => {
    client.sftp((error, session) => {
      if (error) reject(new Error(`${server.name}: cannot open SFTP: ${error.message}`));
      else resolve(session);
    });
  });
  try {
    return await work(sftp);
  } finally {
    try {
      sftp.end();
    } catch {
      /* session already closed */
    }
  }
}

export async function listDir(server, store, path) {
  const target = remotePath(path);
  return withSftp(server, store, (sftp) =>
    new Promise((resolve, reject) => {
      sftp.readdir(target, (error, entries) => {
        if (error) {
          reject(new Error(`${server.name}: cannot list ${target}: ${error.message}`));
          return;
        }
        resolve({
          server: server.name,
          path: target,
          entries: entries
            .map((entry) => ({
              name: entry.filename,
              path: target === '.' ? entry.filename : `${target.replace(/\/+$/, '')}/${entry.filename}`,
              isDirectory: (entry.attrs.mode & 0o040000) === 0o040000,
              size: entry.attrs.size,
              modified: entry.attrs.mtime * 1000,
            }))
            .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)),
        });
      });
    }),
  );
}

export async function upload(server, store, path, buffer) {
  const target = remotePath(path);
  if (!Buffer.isBuffer(buffer)) throw new Error('upload needs a Buffer');
  return withSftp(server, store, (sftp) =>
    new Promise((resolve, reject) => {
      sftp.writeFile(target, buffer, (error) => {
        if (error) reject(new Error(`${server.name}: cannot write ${target}: ${error.message}`));
        else resolve({ server: server.name, path: target, bytes: buffer.length });
      });
    }),
  );
}

export async function download(server, store, path) {
  const target = remotePath(path);
  return withSftp(server, store, (sftp) =>
    new Promise((resolve, reject) => {
      sftp.readFile(target, (error, data) => {
        if (error) reject(new Error(`${server.name}: cannot read ${target}: ${error.message}`));
        else resolve({ server: server.name, path: target, bytes: data.length, data });
      });
    }),
  );
}

export async function mkdir(server, store, path) {
  const target = remotePath(path);
  return withSftp(server, store, (sftp) =>
    new Promise((resolve, reject) => {
      sftp.mkdir(target, { mode: 0o755 }, (error) => {
        if (error && error.code !== 4) {
          reject(new Error(`${server.name}: cannot create ${target}: ${error.message}`));
          return;
        }
        resolve({ server: server.name, path: target });
      });
    }),
  );
}
