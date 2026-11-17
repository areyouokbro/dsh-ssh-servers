/**
 * Server/group store shared by both halves of the bundle.
 *
 * The panel (Host routes) and the MCP server are separate processes, so the
 * only thing they can agree on is a file. Everything here is plain JSON plus
 * an atomic write, which keeps a half-written store from ever being read.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const STORE_VERSION = 1;

/** The DSH home the running profile uses, or the conventional default. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
}

export function pluginDataDir() {
  return path.join(dshHome(), 'plugin-data', 'ssh-manager');
}

export function storePath() {
  return path.join(pluginDataDir(), 'store.json');
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    groups: [],
    servers: [],
    settings: normalizeSettings(null),
  };
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Coerce anything on disk into a shape the rest of the code can trust.
 * A hand-edited store is the normal case, not an exception.
 */
export function normalizeServer(raw) {
  const server = raw !== null && typeof raw === 'object' ? raw : {};
  const authType = server.authType === 'password' ? 'password' : 'key';
  return {
    id: asString(server.id) || newId('srv'),
    name: asString(server.name) || asString(server.host) || 'unnamed',
    host: asString(server.host),
    port: Math.min(65535, Math.max(1, Math.round(asNumber(server.port, 22)))),
    user: asString(server.user) || 'root',
    group: asString(server.group),
    authType,
    password: asString(server.password),
    privateKey: asString(server.privateKey),
    keyPath: asString(server.keyPath),
    passphrase: asString(server.passphrase),
    jump: asString(server.jump),
    tags: Array.isArray(server.tags) ? server.tags.filter((t) => typeof t === 'string') : [],
    note: asString(server.note),
    createdAt: asNumber(server.createdAt, Date.now()),
    updatedAt: asNumber(server.updatedAt, Date.now()),
  };
}

export function normalizeGroup(raw) {
  const group = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    id: asString(group.id) || newId('grp'),
    name: asString(group.name) || 'group',
    color: asString(group.color) || '',
    order: asNumber(group.order, 0),
  };
}

const DEFAULT_SETTINGS = {
  // 'connect' — SSH handshake only. No command is ever executed on the host.
  // 'metrics' — additionally runs one fixed, read-only probe for cpu/mem/disk.
  monitorMode: 'connect',
};

export function normalizeSettings(raw) {
  const settings = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    monitorMode: settings.monitorMode === 'metrics' ? 'metrics' : 'connect',
  };
}

export function normalizeStore(raw) {
  const store = raw !== null && typeof raw === 'object' ? raw : {};
  const groups = Array.isArray(store.groups) ? store.groups.map(normalizeGroup) : [];
  const seenGroupIds = new Set(groups.map((g) => g.id));
  const servers = Array.isArray(store.servers) ? store.servers.map(normalizeServer) : [];
  // A server pointing at a group that no longer exists belongs to "ungrouped".
  for (const server of servers) {
    if (server.group !== '' && !seenGroupIds.has(server.group)) server.group = '';
  }
  return { version: STORE_VERSION, groups, servers, settings: normalizeSettings(store.settings) };
}

/** Read the store; a missing or unreadable file yields an empty inventory. */
export function readStore() {
  const file = storePath();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return emptyStore();
    throw new Error(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return normalizeStore(JSON.parse(text));
  } catch (error) {
    // Keep the broken file for inspection instead of silently wiping it.
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, backup);
    } catch {
      /* the original message below still explains what happened */
    }
    throw new Error(
      `store.json is not valid JSON; it was moved to ${path.basename(backup)}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function writeStore(store) {
  const normalized = normalizeStore(store);
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return normalized;
}

/**
 * Serialize read-modify-write cycles. Two processes cannot lock each other,
 * but each process's own mutations (a UI save racing a tool call) stay ordered.
 */
let chain = Promise.resolve();
export function mutateStore(recipe) {
  const run = chain.then(async () => {
    const store = readStore();
    const next = (await recipe(store)) ?? store;
    return writeStore(next);
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The credential-free view the browser is allowed to see. */
export function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    user: server.user,
    group: server.group,
    authType: server.authType,
    hasPassword: server.password !== '',
    hasPrivateKey: server.privateKey !== '',
    keyPath: server.keyPath,
    hasPassphrase: server.passphrase !== '',
    jump: server.jump,
    tags: server.tags,
    note: server.note,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

export function publicStore(store) {
  return {
    version: store.version,
    settings: normalizeSettings(store.settings),
    groups: store.groups
      .slice()
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    servers: store.servers.slice().sort((a, b) => a.name.localeCompare(b.name)).map(publicServer),
    storePath: storePath(),
  };
}

/** Resolve one server by id, or by an exact/unique-prefix name. */
export function findServer(store, selector) {
  const key = String(selector ?? '').trim();
  if (key === '') throw new Error('server id or name is required');
  const byId = store.servers.find((server) => server.id === key);
  if (byId !== undefined) return byId;
  const byName = store.servers.filter((server) => server.name === key);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(`"${key}" matches ${byName.length} servers; use the server id instead`);
  }
  const prefix = store.servers.filter((server) => server.name.startsWith(key));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw new Error(`"${key}" is ambiguous: ${prefix.map((s) => s.name).join(', ')}`);
  }
  throw new Error(`no server named "${key}". Known: ${store.servers.map((s) => s.name).join(', ') || '(none)'}`);
}

/** The credential set ssh2 needs, with key material read from disk if needed. */
export function resolveAuth(server) {
  if (server.authType === 'password') {
    if (server.password === '') throw new Error(`${server.name}: no password saved`);
    return { password: server.password, readyTimeout: 20000 };
  }
  let key = server.privateKey;
  if (key === '' && server.keyPath !== '') {
    const file = server.keyPath.startsWith('~')
      ? path.join(os.homedir(), server.keyPath.slice(1))
      : server.keyPath;
    try {
      key = fs.readFileSync(file, 'utf8');
    } catch (error) {
      throw new Error(
        `${server.name}: cannot read key file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (key === '') throw new Error(`${server.name}: no private key saved`);
  return {
    privateKey: key,
    ...(server.passphrase === '' ? {} : { passphrase: server.passphrase }),
    readyTimeout: 20000,
  };
}
