/**
 * Host half of dsh-ssh-manager.
 *
 * Owns three things and nothing else:
 *   1. the JSON store (servers + groups) in $DSH_HOME/plugin-data/ssh-manager,
 *   2. the SSH pool used by the panel's routes,
 *   3. the JSON routes those routes are exposed on.
 *
 * The agent does not use this half directly: it talks to `mcp-server.mjs`
 * through the in-box MCP client bridge, and that process reads the same store.
 * Keeping both on one file is what makes a server added in the panel
 * immediately usable by the agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { publicStore, readStore, writeStore, mutateStore, normalizeServer, normalizeGroup, normalizeSettings, findServer, newId, storePath, pluginDataDir } from './lib/store.js';
import { exec, probe, listDir, upload, download, mkdir, dispose as disposePool, poolSize } from './lib/ssh.js';
import { appendJournal, readJournal, journalSummary, journalPath } from './lib/journal.js';
import {
  readMemory,
  addMemoryEntry,
  setMemorySummary,
  removeMemoryEntry,
  clearMemory,
  memoryStats,
} from './lib/memory.js';
import { monitorMany, connectMany, severityOf } from './lib/monitor.js';
import { registerSshTools } from './lib/host-tools.js';
import {
  openShell,
  subscribe,
  replayBuffer,
  sendInput,
  resizeShell,
  closeShell,
  shellCount,
  disposeShells,
  sweepShells,
} from './lib/shell.js';

const ROUTE_PREFIX = '/dsh-ssh-manager';
const MAX_BODY = 32 * 1024 * 1024;
const TOOL_NAME = 'ssh_manager_doctor';
const HEALTH_INTERVAL_MS = 20000;
/**
 * Bump this whenever index.js changes. Host code of a locally linked bundle is
 * not hot-replaced, so "is the running generation the one on disk" is otherwise
 * unanswerable — the doctor tool and /state both report it.
 */
const CODE_GENERATION = 'gen-6-connect-only-monitor';

/**
 * Live health of every managed server, refreshed in the background.
 *
 * This is what makes the panel feel alive: the left rail's status dot and the
 * overview both read this cache, so they update whether or not anyone pressed
 * a button. A probe that is still running is never stacked on top of itself.
 */
const healthCache = new Map();
let healthTimer = null;
let healthBusy = false;

async function refreshHealth() {
  if (healthBusy) return;
  healthBusy = true;
  try {
    const store = readStore();
    if (store.servers.length === 0) {
      healthCache.clear();
      return;
    }
    // The default mode never executes anything: it only opens the SSH session
    // and measures how long the handshake took.
    const mode = store.settings == null ? 'connect' : store.settings.monitorMode;
    const rows =
      mode === 'metrics'
        ? await monitorMany(store.servers, store, { concurrency: 4, timeoutMs: 10000 })
        : await connectMany(store.servers, store, { concurrency: 4 });
    const now = Date.now();
    for (const row of rows) healthCache.set(row.serverId, { at: now, row });
    const alive = new Set(store.servers.map((server) => server.id));
    for (const id of [...healthCache.keys()]) if (!alive.has(id)) healthCache.delete(id);
  } catch (error) {
    warn(`health refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    healthBusy = false;
  }
}

/**
 * Probe according to the configured mode.
 *
 * 'connect' never sends a command: it only establishes the SSH session and
 * times the handshake. 'metrics' adds one fixed read-only probe.
 */
async function probeServers(servers, store, options = {}) {
  const mode = store.settings == null ? 'connect' : store.settings.monitorMode;
  return mode === 'metrics'
    ? monitorMany(servers, store, options)
    : connectMany(servers, store, { concurrency: options.concurrency ?? 4 });
}

/** Store view plus cached liveness, which is what the panel renders. */
function stateView() {
  const published = publicStore(readStore());
  const now = Date.now();
  published.servers = published.servers.map((server) => {
    const cached = healthCache.get(server.id) ?? null;
    return {
      ...server,
      health: cached === null ? null : cached.row,
      healthAt: cached === null ? null : cached.at,
      healthAgeMs: cached === null ? null : now - cached.at,
      severity: cached === null ? 'idle' : severityOf(cached.row),
    };
  });
  published.healthIntervalMs = HEALTH_INTERVAL_MS;
  published.codeGeneration = CODE_GENERATION;
  published.pool = poolSize();
  return published;
}

function warn(message) {
  try {
    console.warn(`[dsh-ssh-manager] ${message}`);
  } catch {
    /* a broken console must not break the plugin */
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error(`request body exceeds ${Math.round(MAX_BODY / 1024 / 1024)} MiB`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function send(response, status, body) {
  try {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
  } catch {
    /* the socket may already be gone */
  }
}

/** Wrap an async handler so any throw becomes one JSON error, never a hang. */
function route(handler) {
  return (request, response) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch((error) => {
        send(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
  };
}

async function serverFrom(store, selector) {
  if (typeof selector !== 'string' || selector.trim() === '') throw new Error('serverId is required');
  const server = findServer(store, selector);
  if (server.host === '') throw new Error(`${server.name}: host is empty`);
  return server;
}

/** Bind a journal writer to one server, so every route records the same shape. */
function journalFor(store, server, actor) {
  const groupName = store.groups.find((group) => group.id === server.group)?.name ?? '';
  return (entry) =>
    appendJournal({
      serverId: server.id,
      server: server.name,
      group: server.group,
      groupName,
      actor,
      ...entry,
    });
}

function registerRoutes(ctx) {
  if (typeof ctx?.inject !== 'function') return;
  try {
    ctx.inject(['webServer'], (scoped) => {
      try {
        if (typeof scoped?.webServer?.register !== 'function') {
          warn('this profile has no webServer service; the panel cannot reach the Host');
          return;
        }

        // ---- request gate --------------------------------------------
        // No cookie gate on writes. This route set listens on 127.0.0.1 only,
        // and in this composition the browser session is not observable in a
        // way that reliably distinguishes the panel from a local script — a
        // check that misfires turns every button into "nothing happens".
        // Writes stay open and every mutation is attributed in the journal
        // instead, which is what actually answers "who changed production".
        const guarded = (handler) => (request, response) => {
          handler(request, response);
        };

        const routes = [
          // ---- inventory -------------------------------------------------
          [
            `${ROUTE_PREFIX}/state`,
            route(async (request, response) => {
              send(response, 200, stateView());
            }),
          ],
          [
            `${ROUTE_PREFIX}/group`,
            route(async (request, response) => {
              const body = await readJson(request);
              const action = body.action === 'delete' ? 'delete' : 'upsert';
              if (typeof body.id !== 'string' && body.name === undefined) {
                throw new Error('group name is required');
              }
              const store = await mutateStore((current) => {
                if (action === 'delete') {
                  const id = String(body.id ?? '');
                  current.groups = current.groups.filter((group) => group.id !== id);
                  // Its servers survive as ungrouped rather than disappearing.
                  for (const server of current.servers) {
                    if (server.group === id) server.group = '';
                  }
                  return current;
                }
                const existing = current.groups.find((group) => group.id === body.id);
                if (existing !== undefined) {
                  if (typeof body.name === 'string' && body.name.trim() !== '') existing.name = body.name.trim();
                  if (typeof body.color === 'string') existing.color = body.color;
                  if (typeof body.order === 'number') existing.order = body.order;
                  return current;
                }
                current.groups.push(
                  normalizeGroup({
                    id: newId('grp'),
                    name: String(body.name ?? 'group').trim() || 'group',
                    color: typeof body.color === 'string' ? body.color : '',
                    order: current.groups.length,
                  }),
                );
                return current;
              });
              send(response, 200, publicStore(store));
            }),
          ],
          [
            `${ROUTE_PREFIX}/server`,
            route(async (request, response) => {
              const body = await readJson(request);
              const action = body.action === 'delete' ? 'delete' : 'upsert';
              const store = await mutateStore((current) => {
                if (action === 'delete') {
                  const id = String(body.id ?? '');
                  current.servers = current.servers.filter((server) => server.id !== id);
                  // Drop jump references that now point nowhere.
                  for (const server of current.servers) {
                    if (server.jump === id) server.jump = '';
                  }
                  return current;
                }
                const existing = current.servers.find((server) => server.id === body.id);
                const merged = normalizeServer({
                  ...(existing ?? {}),
                  ...body,
                  // An empty password means "keep the saved one", not "erase it".
                  password:
                    typeof body.password === 'string' && body.password !== ''
                      ? body.password
                      : (existing?.password ?? ''),
                  privateKey:
                    typeof body.privateKey === 'string' && body.privateKey !== ''
                      ? body.privateKey
                      : (existing?.privateKey ?? ''),
                  passphrase:
                    typeof body.passphrase === 'string' && body.passphrase !== ''
                      ? body.passphrase
                      : (existing?.passphrase ?? ''),
                  id: existing?.id ?? newId('srv'),
                  createdAt: existing?.createdAt ?? Date.now(),
                  updatedAt: Date.now(),
                });
                if (merged.host.trim() === '') throw new Error('host is required');
                if (existing !== undefined) {
                  Object.assign(existing, merged);
                } else {
                  current.servers.push(merged);
                }
                return current;
              });
              send(response, 200, publicStore(store));
            }),
          ],

          // ---- operations ------------------------------------------------
          [
            `${ROUTE_PREFIX}/diag`,
            route(async (request, response) => {
              const out = { package: '@local/dsh-ssh-manager', steps: [] };
              const serviceOf = (name) => {
                for (const scope of [ctx]) {
                  try {
                    if (typeof scope?.get === 'function') {
                      const found = scope.get(name);
                      if (found !== null && found !== undefined) return found;
                    }
                  } catch (error) {
                    out.steps.push(`${name}: lookup threw ${error instanceof Error ? error.message : String(error)}`);
                  }
                }
                return undefined;
              };
              const clientModules = serviceOf('clientModules');
              if (clientModules === undefined) {
                out.clientModules = 'service unavailable';
              } else {
                out.clientModules = 'present';
                out.ownKeys = Object.getOwnPropertyNames(clientModules);
                out.protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(clientModules) ?? {});
                // Dump whatever looks like a per-package table or graph.
                for (const key of out.ownKeys) {
                  try {
                    const value = clientModules[key];
                    if (value instanceof Map) {
                      out[`${key} (Map)`] = [...value.keys()].map(String);
                    } else if (Array.isArray(value)) {
                      out[`${key} (Array)`] = value.slice(0, 40).map((item) =>
                        typeof item === 'string' ? item : JSON.stringify(item)?.slice(0, 300),
                      );
                    }
                  } catch {
                    /* a getter may need a live host; skip it */
                  }
                }
              }
              send(response, 200, out);
            }),
          ],
          [
            `${ROUTE_PREFIX}/client-hello`,
            route(async (request, response) => {
              const body = await readJson(request);
              // Updating and rendering report themselves here so a panel that
              // does not appear can be located without reading a devtools log.
              try {
                const file = path.join(pluginDataDir(), 'client-hello.log');
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.appendFileSync(
                  file,
                  `${new Date().toISOString()} ${JSON.stringify(body)}\n`,
                );
              } catch (error) {
                warn(`cannot record client hello: ${error instanceof Error ? error.message : String(error)}`);
              }
              send(response, 200, { ok: true });
            }),
          ],
          [
            `${ROUTE_PREFIX}/exec`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              const command = String(body.command ?? '');
              const timeoutMs = Number.isFinite(Number(body.timeoutMs))
                ? Math.min(600000, Math.max(1000, Number(body.timeoutMs)))
                : 120000;
              const record = journalFor(store, server, 'panel');
              try {
                const result = await exec(server, command, { store, timeoutMs });
                record({
                  action: 'exec',
                  command,
                  exitCode: result.exitCode,
                  durationMs: result.durationMs,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  ok: result.exitCode === 0,
                });
                send(response, 200, result);
              } catch (error) {
                record({ action: 'exec', command, ok: false, note: error instanceof Error ? error.message : String(error) });
                throw error;
              }
            }),
          ],
          [
            `${ROUTE_PREFIX}/probe`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              send(response, 200, await probe(server, store));
            }),
          ],
          [
            `${ROUTE_PREFIX}/ls`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              send(response, 200, await listDir(server, store, body.path));
            }),
          ],

          // ---- interactive shell (real PTY) ------------------------------
          [
            `${ROUTE_PREFIX}/shell/open`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              const opened = await openShell(server, store, { cols: body.cols, rows: body.rows });
              journalFor(store, server, 'panel')({
                action: 'shell',
                command: 'interactive shell opened',
                ok: true,
              });
              send(response, 200, { ...opened, shells: shellCount() });
            }),
          ],
          [
            `${ROUTE_PREFIX}/shell/stream`,
            (request, response) => {
              // Server-sent events: one JSON string per frame, so remote output
              // containing newlines survives the wire unchanged.
              let shellId = '';
              try {
                shellId = new URL(request.url, 'http://localhost').searchParams.get('shellId') ?? '';
              } catch {
                shellId = '';
              }

              response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
              });

              const frame = (text) => {
                try {
                  response.write(`data: ${JSON.stringify(String(text))}\n\n`);
                } catch {
                  /* the reader went away */
                }
              };

              const history = replayBuffer(shellId);
              if (history !== '') frame(history);

              let unsubscribe = () => {};
              try {
                unsubscribe = subscribe(shellId, (text) => {
                  if (text === null) {
                    frame('');
                    response.write('event: closed\ndata: {}\n\n');
                    try {
                      response.end();
                    } catch {
                      /* already closed */
                    }
                    return;
                  }
                  frame(text);
                });
              } catch (error) {
                frame(`\r\n[${error instanceof Error ? error.message : String(error)}]\r\n`);
                try {
                  response.end();
                } catch {
                  /* already closed */
                }
                return;
              }

              const keepAlive = setInterval(() => {
                try {
                  response.write(': ping\n\n');
                } catch {
                  /* the reader went away */
                }
              }, 15000);
              if (typeof keepAlive.unref === 'function') keepAlive.unref();

              const cleanup = () => {
                clearInterval(keepAlive);
                unsubscribe();
                try {
                  response.end();
                } catch {
                  /* already closed */
                }
              };
              request.on('close', cleanup);
              request.on('error', cleanup);
            },
          ],
          [
            `${ROUTE_PREFIX}/shell/input`,
            route(async (request, response) => {
              const body = await readJson(request);
              sendInput(body.shellId, String(body.data ?? ''));
              send(response, 200, { ok: true });
            }),
          ],
          [
            `${ROUTE_PREFIX}/shell/resize`,
            route(async (request, response) => {
              const body = await readJson(request);
              resizeShell(body.shellId, body.cols, body.rows);
              send(response, 200, { ok: true });
            }),
          ],
          [
            `${ROUTE_PREFIX}/shell/close`,
            route(async (request, response) => {
              const body = await readJson(request);
              send(response, 200, { closed: closeShell(body.shellId) });
            }),
          ],
          [
            `${ROUTE_PREFIX}/upload`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              if (typeof body.remotePath !== 'string' || body.remotePath.trim() === '') {
                throw new Error('remotePath is required');
              }
              const buffer = Buffer.from(String(body.dataBase64 ?? ''), 'base64');
              if (buffer.length === 0) throw new Error('the selected file is empty');
              const result = await upload(server, store, body.remotePath, buffer);
              journalFor(store, server, 'panel')({
                action: 'upload',
                path: result.path,
                bytes: result.bytes,
                ok: true,
              });
              send(response, 200, { ...result, mode: body.mode === 'append' ? 'append' : 'overwrite' });
            }),
          ],
          [
            `${ROUTE_PREFIX}/download`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              if (typeof body.remotePath !== 'string' || body.remotePath.trim() === '') {
                throw new Error('remotePath is required');
              }
              const result = await download(server, store, body.remotePath);
              if (result.bytes > MAX_BODY) {
                throw new Error(`file is ${result.bytes} bytes, above the ${MAX_BODY} byte transfer limit`);
              }
              journalFor(store, server, 'panel')({
                action: 'download',
                path: result.path,
                bytes: result.bytes,
                ok: true,
              });
              send(response, 200, {
                server: result.server,
                path: result.path,
                bytes: result.bytes,
                dataBase64: result.data.toString('base64'),
              });
            }),
          ],
          [
            `${ROUTE_PREFIX}/mkdir`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              const server = await serverFrom(store, body.serverId);
              const result = await mkdir(server, store, body.path);
              journalFor(store, server, 'panel')({ action: 'mkdir', path: result.path, ok: true });
              send(response, 200, result);
            }),
          ],

          // ---- observability ---------------------------------------------
          [
            `${ROUTE_PREFIX}/journal`,
            route(async (request, response) => {
              const body = request.method === 'POST' ? await readJson(request) : {};
              const serverId = typeof body.serverId === 'string' ? body.serverId : '';
              const group = typeof body.group === 'string' ? body.group : '';
              send(response, 200, {
                entries: readJournal({
                  serverId,
                  group,
                  actor: typeof body.actor === 'string' ? body.actor : '',
                  riskyOnly: body.riskyOnly === true,
                  limit: Number(body.limit) || 120,
                }),
                summary: journalSummary({ serverId, group }),
                path: journalPath(),
              });
            }),
          ],
          [
            `${ROUTE_PREFIX}/monitor`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              // One server: probe it now and fold the result into the cache so
              // the rail dot and the page agree with each other.
              if (typeof body.serverId === 'string' && body.serverId !== '') {
                const server = await serverFrom(store, body.serverId);
                const rows = await probeServers([server], store, { concurrency: 1, timeoutMs: 12000 });
                const row = rows[0];
                healthCache.set(server.id, { at: Date.now(), row });
                send(response, 200, { rows, severity: severityOf(row) });
                return;
              }
              const wanted = typeof body.group === 'string' ? body.group : '';
              const servers = wanted === '' ? store.servers : store.servers.filter((s) => s.group === wanted);
              const rows = await probeServers(servers, store, { concurrency: 4, timeoutMs: 12000 });
              const now = Date.now();
              for (const row of rows) healthCache.set(row.serverId, { at: now, row });
              send(response, 200, { rows });
            }),
          ],
          [
            `${ROUTE_PREFIX}/settings`,
            route(async (request, response) => {
              const body = await readJson(request);
              const store = readStore();
              if (body.monitorMode === 'connect' || body.monitorMode === 'metrics') {
                store.settings = normalizeSettings({ ...store.settings, monitorMode: body.monitorMode });
                writeStore(store);
                // Switching mode should show on screen immediately, not on the
                // next scheduled sweep.
                healthCache.clear();
                await refreshHealth();
              }
              send(response, 200, stateView());
            }),
          ],
          [
            `${ROUTE_PREFIX}/memory`,
            route(async (request, response) => {
              const body = await readJson(request);
              const scope = body.scope === 'group' ? 'group' : 'server';
              const id = String(body.id ?? '');
              if (id === '') throw new Error('id is required');
              const action = typeof body.action === 'string' ? body.action : 'read';
              if (action === 'read') {
                send(response, 200, { memory: readMemory(scope, id), stats: memoryStats(scope, id) });
                return;
              }
              if (action === 'summary') {
                send(response, 200, { memory: setMemorySummary(scope, id, body.summary) });
                return;
              }
              if (action === 'add') {
                const kind = body.kind === 'warning' ? 'warning' : 'fact';
                send(response, 200, { memory: addMemoryEntry(scope, id, kind, body.text, 'user') });
                return;
              }
              if (action === 'remove') {
                send(response, 200, {
                  memory: removeMemoryEntry(scope, id, body.kind === 'warning' ? 'warning' : 'fact', body.index),
                });
                return;
              }
              if (action === 'clear') {
                send(response, 200, { memory: clearMemory(scope, id) });
                return;
              }
              throw new Error(`unknown memory action: ${action}`);
            }),
          ],
        ];

        for (const [path, handler] of routes) {
          try {
            scoped.webServer.register({ kind: 'exact', path, handler: guarded(handler) });
          } catch (error) {
            warn(`could not register ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        warn(`webServer registration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject webServer: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * One diagnostic tool. It exists so "the agent cannot see my servers" has an
 * answer inside the conversation instead of in a log file.
 */
function registerDoctor(ctx) {
  if (typeof ctx?.inject !== 'function') return;
  try {
    ctx.inject(['tools'], (scoped) => {
      try {
        if (typeof scoped?.tools?.register !== 'function') return;
        // The agent-facing SSH tools live here, not behind an MCP child
        // process: a published bundle cannot point an MCP row at its own files.
        const registeredToolNames = registerSshTools(scoped.tools);
        const dispose = scoped.tools.register({
          name: TOOL_NAME,
          description:
            'Diagnose the SSH server manager: where its store file is, how many servers and groups it holds, which pooled connections are open, which ssh_* tools it registered, and which code generation is running. Use this when the agent reports that no server is known or the SSH tools are missing.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inspectTools: {
                type: 'boolean',
                description: 'Also list the registered mcp__ssh__* tool names. Defaults to true.',
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                storePath: { type: 'string' },
                servers: { type: 'integer' },
                groups: { type: 'integer' },
                pooled: { type: 'integer' },
                sshTools: { type: 'array', items: { type: 'string' } },
                codeGeneration: { type: 'string' },
                note: { type: 'string' },
              },
              required: ['storePath', 'servers', 'groups', 'pooled', 'sshTools', 'codeGeneration', 'note'],
            },
            render(_args, value) {
              const lines = [
                `store    : ${value.storePath}`,
                `servers  : ${value.servers}   groups: ${value.groups}   pooled connections: ${value.pooled}`,
                `generation: ${value.codeGeneration}`,
                `mcp tools: ${value.sshTools.length === 0 ? '(none registered)' : value.sshTools.join(', ')}`,
              ];
              if (value.note !== '') lines.push('', value.note);
              return [{ type: 'text', text: lines.join('\n') }];
            },
          },
          execute(args) {
            const store = readStore();
            const names = args?.inspectTools === false ? [] : registeredToolNames.slice();
            const note =
              store.servers.length === 0
                ? 'The store holds no server yet. Add one in Settings → SSH servers, or call the ssh_add_server tool.'
                : '';
            return {
              storePath: storePath(),
              servers: store.servers.length,
              groups: store.groups.length,
              pooled: poolSize(),
              sshTools: names,
              codeGeneration: CODE_GENERATION,
              note,
            };
          },
        });
        try {
          if (typeof dispose === 'function' && typeof scoped.on === 'function') scoped.on('dispose', dispose);
        } catch {
          /* disposal is best-effort */
        }
      } catch (error) {
        warn(`could not register ${TOOL_NAME}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject tools: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function apply(ctx) {
  registerRoutes(ctx);
  registerDoctor(ctx);
  // Background liveness: probe once on load, then keep it fresh. Torn down
  // with the plugin, and never stacked on top of a running sweep.
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => {
      refreshHealth();
      healthTimer = setInterval(refreshHealth, HEALTH_INTERVAL_MS);
      if (typeof healthTimer.unref === 'function') healthTimer.unref();
      const shellTimer = setInterval(sweepShells, 60000);
      if (typeof shellTimer.unref === 'function') shellTimer.unref();
      return () => {
        if (healthTimer !== null) {
          clearInterval(healthTimer);
          healthTimer = null;
        }
        clearInterval(shellTimer);
        // Ends every PTY channel and the pooled connections behind them.
        disposeShells();
      };
    });
  } else if (typeof ctx?.on === 'function') {
    ctx.on('dispose', () => disposeShells());
  }
}

export default { name: '@local/dsh-ssh-manager', apply };
