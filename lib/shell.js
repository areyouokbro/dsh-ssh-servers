/**
 * Interactive shells.
 *
 * Unlike `exec`, this opens a real PTY channel: the remote login shell behaves
 * as it does for a human, so prompts, colours, `cd`, `vim`, `top` and
 * `tail -f` all work. Output is streamed to the panel over SSE, and keystrokes
 * are forwarded back on the same channel.
 *
 * Sessions are host-process objects. They are closed when the panel disconnects,
 * when the remote shell exits, or when the plugin unloads.
 */
import crypto from 'node:crypto';
import { acquire, dispose as disposePool } from './ssh.js';

const sessions = new Map();
const MAX_BUFFER = 512 * 1024;
const IDLE_LIMIT_MS = 30 * 60 * 1000;

/**
 * @param {object} server
 * @param {object} store
 * @param {{cols?: number, rows?: number}} options
 */
export async function openShell(server, store, options = {}) {
  const cols = Math.min(500, Math.max(20, Number(options.cols) || 120));
  const rows = Math.min(200, Math.max(8, Number(options.rows) || 32));
  const client = await acquire(server, store);

  const stream = await new Promise((resolve, reject) => {
    client.shell({ term: 'xterm-256color', cols, rows }, (error, channel) => {
      if (error) reject(new Error(`${server.name}: cannot open shell: ${error.message}`));
      else resolve(channel);
    });
  });

  const id = `sh_${crypto.randomBytes(8).toString('hex')}`;
  const session = {
    id,
    serverId: server.id,
    serverName: server.name,
    stream,
    buffer: '',
    subscribers: new Set(),
    closed: false,
    lastAt: Date.now(),
    cols,
    rows,
  };

  stream.setWindow(rows, cols, 0, 0);

  stream.on('data', (chunk) => {
    session.lastAt = Date.now();
    const text = chunk.toString('utf8');
    session.buffer += text;
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER / 2);
    for (const notify of session.subscribers) {
      try {
        notify(text);
      } catch {
        /* a dead sink is removed by close() */
      }
    }
  });

  const finish = () => {
    if (session.closed) return;
    session.closed = true;
    sessions.delete(id);
    for (const notify of session.subscribers) {
      try {
        notify(null);
      } catch {
        /* nothing to tell */
      }
    }
    session.subscribers.clear();
    try {
      stream.end();
    } catch {
      /* already gone */
    }
  };

  stream.on('close', finish);
  stream.on('error', finish);
  streams.add(stream);
  session.finish = () => {
    streams.delete(stream);
    finish();
  };

  sessions.set(id, session);
  return { shellId: id, cols, rows, server: server.name };
}

/** Open PTY channels, tracked so unload can end them. */
const streams = new Set();

export function getShell(shellId) {
  const session = sessions.get(String(shellId));
  if (session === undefined) throw new Error('this terminal session is gone — reload the tab');
  return session;
}

/** Replay what the shell has already printed, so a late subscriber sees it. */
export function replayBuffer(shellId) {
  const session = sessions.get(String(shellId));
  return session === undefined ? '' : session.buffer;
}

export function subscribe(shellId, notify) {
  const session = getShell(shellId);
  session.subscribers.add(notify);
  session.lastAt = Date.now();
  return () => session.subscribers.delete(notify);
}

export function sendInput(shellId, data) {
  const session = getShell(shellId);
  session.lastAt = Date.now();
  if (session.closed) throw new Error('shell already closed');
  session.stream.write(data);
}

export function resizeShell(shellId, cols, rows) {
  const session = getShell(shellId);
  const width = Math.min(500, Math.max(20, Number(cols) || session.cols));
  const height = Math.min(200, Math.max(8, Number(rows) || session.rows));
  session.cols = width;
  session.rows = height;
  try {
    session.stream.setWindow(height, width, 0, 0);
  } catch {
    /* the channel may already be gone */
  }
}

export function closeShell(shellId) {
  const session = sessions.get(String(shellId));
  if (session === undefined) return false;
  session.finish();
  return true;
}

export function shellCount() {
  return sessions.size;
}

/** Reap shells nobody is looking at, and end the rest on unload. */
export function sweepShells() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.subscribers.size === 0 && now - session.lastAt > IDLE_LIMIT_MS) {
      session.finish();
      sessions.delete(id);
    }
  }
}

export function disposeShells() {
  for (const session of [...sessions.values()]) session.finish();
  sessions.clear();
  disposePool();
}
