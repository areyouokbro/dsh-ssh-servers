/**
 * stdio MCP server for dsh-ssh-servers — an OPTIONAL transport.
 *
 * The bundle registers the same tools through ctx.tools.register on the Host
 * instead of spawning this process, because a patch cannot reference a file
 * inside its own package without hard-coding an absolute path. Run this file
 * yourself if you want the `mcp__<serverName>__<tool>` namespace back:
 *
 *   node ./node_modules/dsh-ssh-servers/mcp-server.mjs
 *
 * It reads the same store file the panel writes, so both paths share one
 * inventory. Rules of the road:
 *   - stdout is the wire; every diagnostic goes to stderr.
 *   - a tool failure is a result with isError, never a dropped connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicStore, readStore, mutateStore, normalizeServer, newId, findServer, storePath, pluginDataDir } from './lib/store.js';
import { exec, probe, listDir, upload, download, mkdir, dispose as disposePool } from './lib/ssh.js';
import { appendJournal, readJournal, journalSummary } from './lib/journal.js';
import { readMemory, addMemoryEntry, setMemorySummary, clearMemory, renderMemory } from './lib/memory.js';
import { monitorMany, connectMany, monitorOne, renderMonitorRow } from './lib/monitor.js';

const SERVER_NAME = 'ssh-manager';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
// Handshake diagnostics: off by default. `MCP_TRACE=on` writes to the plugin
// data directory, any other non-empty value is treated as a path.
const TRACE_SETTING = process.env.MCP_TRACE ?? '';
const TRACE_FILE =
  TRACE_SETTING === '' || TRACE_SETTING === '0' || TRACE_SETTING === 'off'
    ? ''
    : TRACE_SETTING === 'on'
      ? path.join(pluginDataDir(), 'mcp-trace.log')
      : TRACE_SETTING;

/** Append-only wire log, off only when MCP_TRACE says so. */
let traceDirReady = false;
function trace(direction, text) {
  if (TRACE_FILE === '') return;
  try {
    if (!traceDirReady) {
      fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
      traceDirReady = true;
    }
    fs.appendFileSync(TRACE_FILE, `${new Date().toISOString()} ${direction} ${text}\n`);
  } catch {
    /* tracing must never break the wire */
  }
}

function log(message) {
  try {
    process.stderr.write(`[dsh-ssh-manager:mcp] ${message}\n`);
  } catch {
    /* stderr closed; nothing useful left to do */
  }
}

/**
 * Tool results in MCP shape. Exported so the Host half can reuse the very same
 * definitions through ctx.tools.register instead of spawning this process.
 */
export function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function summary(store) {
  const groupName = new Map(store.groups.map((group) => [group.id, group.name]));
  if (store.servers.length === 0) {
    return 'No server is configured yet. Add one with ssh_add_server, or let the user add it in Settings → SSH servers.';
  }
  const lines = [`${store.servers.length} server(s) across ${store.groups.length} group(s):`];
  const byGroup = new Map();
  for (const server of store.servers) {
    const key = server.group === '' ? '(ungrouped)' : (groupName.get(server.group) ?? '(unknown group)');
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(server);
  }
  for (const [group, servers] of byGroup) {
    lines.push('', `## ${group}`);
    for (const server of servers) {
      const auth = server.authType === 'password' ? 'password' : 'key';
      const jump = server.jump === '' ? '' : ` via ${server.jump}`;
      lines.push(
        `- ${server.name}  (id ${server.id})  ${server.user}@${server.host}:${server.port}  [${auth}]${jump}${
          server.note === '' ? '' : `  — ${server.note}`
        }`,
      );
    }
  }
  return lines.join('\n');
}

/** Resolve a selector into a server, with the store's error text on failure. */
function pick(store, selector) {
  try {
    const server = findServer(store, selector);
    if (server.host === '') throw new Error(`${server.name}: host is empty`);
    return server;
  } catch (error) {
    throw new Error(`${error.message}\n\n${summary(store)}`);
  }
}

/** Journal writer bound to one server; every mutation goes through this. */
function recordOn(store, server) {
  const groupName = store.groups.find((group) => group.id === server.group)?.name ?? '';
  return (entry) =>
    appendJournal({
      serverId: server.id,
      server: server.name,
      group: server.group,
      groupName,
      actor: 'agent',
      ...entry,
    });
}

const RISK_TAIL = `

⚠ 已按风险操作记录。若这是有意的变更，请用 ssh_memory 记下改了什么、为什么、怎么回滚。`;

function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required`);
  return value;
}

function formatExec(result) {
  const head = `[${result.server}] $ ${result.command}`;
  const meta = `exit ${result.exitCode === null ? '?' : result.exitCode} · ${result.durationMs} ms${
    result.truncated ? ' · output truncated' : ''
  }`;
  const parts = [head, meta];
  if (result.stdout.trim() !== '') parts.push('--- stdout ---', result.stdout.trimEnd());
  if (result.stderr.trim() !== '') parts.push('--- stderr ---', result.stderr.trimEnd());
  if (result.stdout.trim() === '' && result.stderr.trim() === '') parts.push('(no output)');
  return parts.join('\n');
}

export const TOOLS = [
  {
    name: 'ssh_list_servers',
    description:
      'List the managed SSH servers and their groups. Call this first: every other ssh_* tool takes a server name (or id) from this list.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        group: { type: 'string', description: 'Only servers in this group name (or group id).' },
        query: { type: 'string', description: 'Case-insensitive filter on name, host, user, tag or note.' },
      },
    },
    async run(args) {
      const store = readStore();
      let servers = store.servers;
      if (typeof args?.group === 'string' && args.group.trim() !== '') {
        const wanted = args.group.trim().toLowerCase();
        const group = store.groups.find(
          (entry) => entry.id === args.group || entry.name.toLowerCase() === wanted,
        );
        if (group === undefined) {
          throw new Error(
            `no group "${args.group}". Known groups: ${store.groups.map((g) => g.name).join(', ') || '(none)'}`,
          );
        }
        servers = servers.filter((server) => server.group === group.id);
      }
      if (typeof args?.query === 'string' && args.query.trim() !== '') {
        const q = args.query.trim().toLowerCase();
        servers = servers.filter((server) =>
          [server.name, server.host, server.user, server.note, ...server.tags]
            .join(' ')
            .toLowerCase()
            .includes(q),
        );
      }
      if (servers.length === 0) return text(`No server matches.\n\n${summary(store)}`);
      const groupName = new Map(store.groups.map((group) => [group.id, group.name]));
      const lines = servers.map((server) => {
        const auth = server.authType === 'password' ? 'password' : 'key';
        return `- ${server.name}  (id ${server.id})  group ${server.group === '' ? '(ungrouped)' : groupName.get(server.group) ?? '?'}  ${server.user}@${server.host}:${server.port}  [${auth}]`;
      });
      return text(lines.join('\n'));
    },
  },
  {
    name: 'ssh_list_groups',
    description: 'List the server groups and how many servers each one holds.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      const store = readStore();
      if (store.groups.length === 0) {
        return text(`No group defined. ${store.servers.filter((s) => s.group === '').length} ungrouped server(s).`);
      }
      const counts = new Map();
      for (const server of store.servers) counts.set(server.group, (counts.get(server.group) ?? 0) + 1);
      const lines = store.groups
        .slice()
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((group) => `- ${group.name}  (id ${group.id})  ${counts.get(group.id) ?? 0} server(s)`);
      const ungrouped = counts.get('') ?? 0;
      if (ungrouped > 0) lines.push(`- (ungrouped)  ${ungrouped} server(s)`);
      return text(lines.join('\n'));
    },
  },
  {
    name: 'ssh_brief',
    description:
      'Read everything known about a server BEFORE changing it: group memory, the server\'s own memory (facts and warnings), recent operations with their exit codes, and live health. Call this first on any server you have not touched in this session — it is what keeps a deployment from repeating a past outage.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { server: { type: 'string', description: 'Server name or id.' } },
      required: ['server'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const group = server.group === '' ? null : (store.groups.find((entry) => entry.id === server.group) ?? null);
      const serverMemory = readMemory('server', server.id);
      const groupMemory = group === null ? null : readMemory('group', group.id);
      const history = readJournal({ serverId: server.id, limit: 10 });
      const stats = journalSummary({ serverId: server.id });

      const healthMode = store.settings == null ? 'connect' : store.settings.monitorMode;
      const health =
        healthMode === 'metrics'
          ? await monitorOne(server, store, 8000)
          : (await connectMany([server], store))[0];
      const lines = [
        `# ${server.name}  (id ${server.id})`,
        `${server.user}@${server.host}:${server.port}  [${server.authType === 'password' ? 'password' : 'key'}]${
          server.jump === '' ? '' : `  via ${server.jump}`
        }`,
        group === null ? 'group: (ungrouped)' : `group: ${group.name}`,
        server.note === '' ? '' : `note: ${server.note}`,
        '',
        `health: ${renderMonitorRow(health).trim()}`,
        '',
        groupMemory === null ? '' : renderMemory(groupMemory, `## 组记忆 · ${group.name}`),
        '',
        renderMemory(serverMemory, '## 服务器记忆'),
        '',
        `## 最近操作（采样 ${stats.sampled} 条 · 风险 ${stats.risky} 次 · 失败 ${stats.failed} 次）`,
      ];

      if (history.length === 0) {
        lines.push('  (还没有操作记录)');
      } else {
        for (const record of history) {
          const when = String(record.at).replace('T', ' ').slice(0, 19);
          const risk = Array.isArray(record.risk) && record.risk.length > 0 ? ` ⚠${record.risk.join('/')}` : '';
          const what = record.action === 'exec' ? record.command : `${record.action} ${record.path}`;
          lines.push(`  ${when} [${record.actor}] ${what}${risk} → ${record.ok === false ? 'FAILED' : 'ok'}`);
        }
      }
      lines.push(
        '',
        '下一步：用 ssh_exec 执行变更；改完用 ssh_memory 记下改了什么、为什么、怎么回滚。',
      );
      return text(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
    },
  },
  {
    name: 'ssh_monitor',
    description:
      'Fleet health in one call: load, memory use, root disk, uptime and latency for every managed server, or just one group. Use it before and after a change to show the change did not hurt anything.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        group: { type: 'string', description: 'Only servers in this group name (or id). Omit for all servers.' },
      },
    },
    async run(args) {
      const store = readStore();
      let servers = store.servers;
      if (typeof args?.group === 'string' && args.group.trim() !== '') {
        const wanted = args.group.trim().toLowerCase();
        const group = store.groups.find((entry) => entry.id === args.group || entry.name.toLowerCase() === wanted);
        if (group === undefined) {
          throw new Error(`no group "${args.group}". Known groups: ${store.groups.map((g) => g.name).join(', ') || '(none)'}`);
        }
        servers = servers.filter((server) => server.group === group.id);
      }
      if (servers.length === 0) return text('No server to monitor.');
      const mode = store.settings == null ? 'connect' : store.settings.monitorMode;
      const rows =
        mode === 'metrics'
          ? await monitorMany(servers, store, { concurrency: 4, timeoutMs: 12000 })
          : await connectMany(servers, store);
      const healthy = rows.filter((row) => row.ok === true).length;
      const header =
        mode === 'metrics'
          ? `${healthy}/${rows.length} reachable (read-only metrics probe)`
          : `${healthy}/${rows.length} reachable (connection only — no command was executed)`;
      return text([header, '', ...rows.map((row) => renderMonitorRow(row))].join('\n'));
    },
  },
  {
    name: 'ssh_journal',
    description:
      'Query the operations journal: exactly which command ran on which server, by whom (agent or panel), when, with exit code and an output preview. Use it to review your own recent work, or to find what changed before an incident.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Only this server (name or id).' },
        group: { type: 'string', description: 'Only servers in this group (name or id).' },
        actor: { type: 'string', enum: ['agent', 'panel'], description: 'Only operations by this caller.' },
        riskyOnly: { type: 'boolean', description: 'Only operations flagged as risky.' },
        limit: { type: 'integer', description: 'How many entries, newest first. Default 40.' },
      },
    },
    async run(args) {
      const store = readStore();
      let serverId = '';
      if (typeof args?.server === 'string' && args.server.trim() !== '') {
        serverId = pick(store, args.server).id;
      }
      let groupId = '';
      if (typeof args?.group === 'string' && args.group.trim() !== '') {
        const wanted = args.group.trim().toLowerCase();
        const group = store.groups.find((entry) => entry.id === args.group || entry.name.toLowerCase() === wanted);
        if (group === undefined) throw new Error(`no group "${args.group}"`);
        groupId = group.id;
      }
      const entries = readJournal({
        serverId,
        group: groupId,
        actor: typeof args?.actor === 'string' ? args.actor : '',
        riskyOnly: args?.riskyOnly === true,
        limit: Number(args?.limit) || 40,
      });
      if (entries.length === 0) return text('The journal has no entry matching that filter.');
      const lines = entries.map((record) => {
        const when = String(record.at).replace('T', ' ').slice(0, 19);
        const risk = Array.isArray(record.risk) && record.risk.length > 0 ? ` ⚠${record.risk.join('/')}` : '';
        const what = record.action === 'exec' ? record.command : `${record.action} ${record.path}`;
        const outcome =
          record.exitCode === null || record.exitCode === undefined
            ? record.ok === false
              ? 'FAILED'
              : 'ok'
            : `exit ${record.exitCode}`;
        return `${when}  ${record.server.padEnd(16)} [${record.actor}] ${what}  → ${outcome}${risk}`;
      });
      return text(`${entries.length} 条（最新在前）\n\n${lines.join('\n')}`);
    },
  },
  {
    name: 'ssh_memory',
    description:
      'Read or write the memory notebook of a server or a group. Use kind "warning" for things that must not be done again (load-bearing paths, a past outage, a service that cannot restart), and "fact" for stable knowledge (what runs here, ports, deploy layout, cron jobs). Write after every meaningful change: what changed, why, and how to roll back. This is what a future session reads before touching the same machine.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: { type: 'string', enum: ['server', 'group'], description: 'Whose notebook. Defaults to server.' },
        target: { type: 'string', description: 'Server name/id, or group name/id.' },
        action: {
          type: 'string',
          enum: ['read', 'add', 'summary', 'clear'],
          description: 'read (default), add one entry, replace the summary line, or wipe the notebook.',
        },
        kind: { type: 'string', enum: ['fact', 'warning'], description: 'Entry kind for action=add. Defaults to fact.' },
        text: { type: 'string', description: 'Entry text for add, or the summary for action=summary.' },
      },
      required: ['target'],
    },
    async run(args) {
      const store = readStore();
      const scope = args?.scope === 'group' ? 'group' : 'server';
      const target = requireString(args, 'target');
      let id;
      let label;
      if (scope === 'group') {
        const wanted = target.trim().toLowerCase();
        const group = store.groups.find((entry) => entry.id === target || entry.name.toLowerCase() === wanted);
        if (group === undefined) {
          throw new Error(`no group "${target}". Known groups: ${store.groups.map((g) => g.name).join(', ') || '(none)'}`);
        }
        id = group.id;
        label = group.name;
      } else {
        const server = pick(store, target);
        id = server.id;
        label = server.name;
      }
      const action = typeof args?.action === 'string' ? args.action : 'read';
      const heading = `${scope === 'group' ? '组' : '服务器'}记忆 · ${label}`;

      if (action === 'read') {
        return text(renderMemory(readMemory(scope, id), heading));
      }
      if (action === 'add') {
        const kind = args?.kind === 'warning' ? 'warning' : 'fact';
        const memory = addMemoryEntry(scope, id, kind, requireString(args, 'text'), 'agent');
        return text(`已记录到${heading}。\n\n${renderMemory(memory, heading)}`);
      }
      if (action === 'summary') {
        const memory = setMemorySummary(scope, id, requireString(args, 'text'));
        return text(`已更新摘要：${heading}\n\n${renderMemory(memory, heading)}`);
      }
      if (action === 'clear') {
        clearMemory(scope, id);
        return text(`已清空${heading}。`);
      }
      throw new Error(`unknown action "${action}"`);
    },
  },
  {
    name: 'ssh_exec',
    description:
      'Run one shell command on a managed server over SSH and return stdout, stderr and the exit code. This is the main operations tool: inspecting services, reading logs, tailing files, deploying, restarting. Each call is a fresh command, not an interactive session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Server name or id, as reported by ssh_list_servers.' },
        command: { type: 'string', description: 'Shell command to run, executed by the login shell.' },
        timeoutMs: {
          type: 'integer',
          description: 'Abort after this many milliseconds (default 120000, max 600000).',
        },
      },
      required: ['server', 'command'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const command = requireString(args, 'command');
      const timeoutMs = Number.isFinite(Number(args?.timeoutMs))
        ? Math.min(600000, Math.max(1000, Number(args.timeoutMs)))
        : 120000;
      const record = recordOn(store, server);
      try {
        const result = await exec(server, command, { store, timeoutMs });
        const saved = record({
          action: 'exec',
          command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
          ok: result.exitCode === 0,
        });
        const body = formatExec(result);
        return text(saved.risk.length > 0 ? `${body}${RISK_TAIL}` : body);
      } catch (error) {
        record({ action: 'exec', command, ok: false, note: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  },
  {
    name: 'ssh_test',
    description:
      'Check that a managed server accepts the saved credentials and report latency, platform, uptime and disk usage. Use it before a long operation, or to diagnose a connection that keeps failing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { server: { type: 'string', description: 'Server name or id.' } },
      required: ['server'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const result = await probe(server, store);
      return text(
        [
          `[${result.server}] ${result.ok ? 'reachable' : 'reached, command failed'} in ${result.latencyMs} ms`,
          result.platform === '' ? '' : `platform: ${result.platform}`,
          result.uptime === '' ? '' : `uptime  : ${result.uptime}`,
          result.disk === '' ? '' : `disk    : ${result.disk}`,
        ]
          .filter((line) => line !== '')
          .join('\n'),
      );
    },
  },
  {
    name: 'ssh_ls',
    description: 'List a remote directory over SFTP. `path` defaults to the login directory; `~` also means it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Server name or id.' },
        path: { type: 'string', description: 'Remote directory. Defaults to the login directory.' },
      },
      required: ['server'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const result = await listDir(server, store, args?.path);
      if (result.entries.length === 0) return text(`[${result.server}] ${result.path} is empty`);
      const lines = result.entries.map(
        (entry) =>
          `${entry.isDirectory ? 'd' : '-'} ${String(entry.size).padStart(9)}  ${entry.name}${
            entry.isDirectory ? '/' : ''
          }`,
      );
      return text(`[${result.server}] ${result.path}\n${lines.join('\n')}`);
    },
  },
  {
    name: 'ssh_download',
    description:
      'Read one remote file over SFTP and return its content. Use encoding utf8 for text (configs, logs, scripts) and base64 for binaries. Files above 32 MiB are refused.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Server name or id.' },
        path: { type: 'string', description: 'Absolute remote file path.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Defaults to utf8.' },
      },
      required: ['server', 'path'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const result = await download(server, store, requireString(args, 'path'));
      const encoding = args?.encoding === 'base64' ? 'base64' : 'utf8';
      recordOn(store, server)({ action: 'download', path: result.path, bytes: result.bytes, ok: true });
      const body = result.data.toString(encoding);
      return text(`[${result.server}] ${result.path} · ${result.bytes} bytes · ${encoding}\n\n${body}`);
    },
  },
  {
    name: 'ssh_upload',
    description:
      'Write a file to a remote path over SFTP, overwriting it. Content is text (utf8, default) or base64 for binaries. Use it to drop a config, a unit file or a script onto a server.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Server name or id.' },
        path: { type: 'string', description: 'Absolute remote file path.' },
        content: { type: 'string', description: 'File content.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Defaults to utf8.' },
      },
      required: ['server', 'path', 'content'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const encoding = args?.encoding === 'base64' ? 'base64' : 'utf8';
      const buffer = Buffer.from(requireString(args, 'content'), encoding);
      const result = await upload(server, store, requireString(args, 'path'), buffer);
      recordOn(store, server)({ action: 'upload', path: result.path, bytes: result.bytes, ok: true });
      return text(`[${result.server}] wrote ${result.bytes} bytes to ${result.path}`);
    },
  },
  {
    name: 'ssh_mkdir',
    description: 'Create a remote directory (one level) over SFTP.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Server name or id.' },
        path: { type: 'string', description: 'Absolute remote directory path.' },
      },
      required: ['server', 'path'],
    },
    async run(args) {
      const store = readStore();
      const server = pick(store, requireString(args, 'server'));
      const result = await mkdir(server, store, requireString(args, 'path'));
      recordOn(store, server)({ action: 'mkdir', path: result.path, ok: true });
      return text(`[${result.server}] created ${result.path}`);
    },
  },
  {
    name: 'ssh_add_server',
    description:
      'Add a server to the inventory, or update one that already exists (identified by `server`, its name or id). The user then sees it in Settings → SSH servers. Credentials are stored in the plugin store, not in the profile patch.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Display name, unique and short, e.g. web-01.' },
        host: { type: 'string', description: 'Hostname or IP address.' },
        user: { type: 'string', description: 'Login user. Defaults to root.' },
        port: { type: 'integer', description: 'SSH port. Defaults to 22.' },
        group: { type: 'string', description: 'Group name or id. Created if missing.' },
        authType: { type: 'string', enum: ['key', 'password'], description: 'Defaults to key.' },
        privateKey: { type: 'string', description: 'PEM/OpenSSH private key content, for authType key.' },
        keyPath: { type: 'string', description: 'Local path to a private key file, alternative to privateKey.' },
        passphrase: { type: 'string', description: 'Passphrase for the private key, if any.' },
        password: { type: 'string', description: 'Password, for authType password.' },
        jump: { type: 'string', description: 'Server name or id to reach this one through (jump host).' },
        note: { type: 'string', description: 'Free-form note shown in the panel.' },
      },
      required: ['name', 'host'],
    },
    async run(args) {
      const name = requireString(args, 'name').trim();
      const host = requireString(args, 'host').trim();
      let created = '';
      const store = await mutateStore((current) => {
        const existing =
          current.servers.find((server) => server.name === name || server.id === args.server) ?? null;
        let groupId = existing?.group ?? '';
        if (typeof args.group === 'string' && args.group.trim() !== '') {
          const wanted = args.group.trim().toLowerCase();
          const group = current.groups.find(
            (entry) => entry.id === args.group || entry.name.toLowerCase() === wanted,
          );
          if (group !== undefined) {
            groupId = group.id;
          } else {
            const fresh = { id: newId('grp'), name: args.group.trim(), color: '', order: current.groups.length };
            current.groups.push(fresh);
            groupId = fresh.id;
            created = fresh.name;
          }
        }
        const merged = normalizeServer({
          ...(existing ?? {}),
          name,
          host,
          ...(args.user === undefined ? {} : { user: args.user }),
          ...(args.port === undefined ? {} : { port: args.port }),
          ...(args.authType === undefined ? {} : { authType: args.authType }),
          ...(args.privateKey === undefined ? {} : { privateKey: args.privateKey }),
          ...(args.keyPath === undefined ? {} : { keyPath: args.keyPath }),
          ...(args.passphrase === undefined ? {} : { passphrase: args.passphrase }),
          ...(args.password === undefined ? {} : { password: args.password }),
          ...(args.jump === undefined ? {} : { jump: args.jump }),
          ...(args.note === undefined ? {} : { note: args.note }),
          group: groupId,
          id: existing?.id ?? newId('srv'),
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
        if (existing !== null) Object.assign(existing, merged);
        else current.servers.push(merged);
        return current;
      });
      const server = store.servers.find((entry) => entry.name === name);
      return text(
        `${server === undefined ? 'saved' : `saved ${server.name}`} (id ${server?.id ?? '?'}) at ${server?.user}@${server?.host}:${server?.port}${
          server !== undefined && server.group !== ''
            ? ` in group ${store.groups.find((g) => g.id === server.group)?.name ?? server.group}`
            : ''
        }${created === '' ? '' : ` (group ${created} created)`}.\n\n${summary(store)}`,
      );
    },
  },
  {
    name: 'ssh_delete_server',
    description: 'Remove a server from the inventory by name or id. It does not touch the remote machine.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { server: { type: 'string', description: 'Server name or id.' } },
      required: ['server'],
    },
    async run(args) {
      const selector = requireString(args, 'server');
      let removed = '';
      const store = await mutateStore((current) => {
        const target = findServer(current, selector);
        removed = target.name;
        current.servers = current.servers.filter((server) => server.id !== target.id);
        for (const server of current.servers) if (server.jump === target.id) server.jump = '';
        return current;
      });
      return text(`removed ${removed}.\n\n${summary(store)}`);
    },
  },
  {
    name: 'ssh_list_groups_and_servers',
    description: 'One-shot inventory dump: every group with its servers, and the ungrouped ones.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      return text(summary(readStore()));
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

async function callTool(name, args) {
  const tool = TOOL_MAP.get(name);
  if (tool === undefined) {
    return fail(`Unknown tool "${name}". Available: ${TOOLS.map((entry) => entry.name).join(', ')}`);
  }
  try {
    return await tool.run(args ?? {});
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function send(message) {
  try {
    const payload = JSON.stringify(message);
    trace('OUT', payload);
    process.stdout.write(`${payload}\n`);
  } catch (error) {
    log(`cannot write to stdout: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handle(message) {
  const id = message.id;
  const method = typeof message.method === 'string' ? message.method : '';
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion:
          typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Manage SSH servers. Call ssh_list_servers first, then ssh_exec with a server name. Servers and groups are shared with the Settings panel.',
      },
    });
    return;
  }
  if (isNotification) {
    // notifications/initialized, notifications/cancelled: nothing to answer.
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const result = await callTool(message.params?.name, message.params?.arguments);
    send({ jsonrpc: '2.0', id, result });
    return;
  }
  if (method === 'resources/list' || method === 'prompts/list') {
    send({ jsonrpc: '2.0', id, result: { [method === 'resources/list' ? 'resources' : 'prompts']: [] } });
    return;
  }
  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

let queue = Promise.resolve();
function enqueue(line) {
  trace('IN ', line);
  queue = queue.then(async () => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      log('dropping a line that is not JSON');
      return;
    }
    try {
      if (Array.isArray(parsed)) {
        for (const item of parsed) await handle(item);
      } else {
        await handle(parsed);
      }
    } catch (error) {
      log(`handler crashed: ${error instanceof Error ? error.message : String(error)}`);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  });
}

/**
 * The stdio transport. Wrapped so importing this module (the Host does, to
 * reuse TOOLS through ctx.tools.register) does not hijack stdin.
 */
function serve() {
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    pending += chunk;
    let index = pending.indexOf('\n');
    while (index !== -1) {
      const line = pending.slice(0, index).trim();
      pending = pending.slice(index + 1);
      if (line !== '') enqueue(line);
      index = pending.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    const rest = pending.trim();
    if (rest !== '') enqueue(rest);
    queue.finally(() => {
      disposePool();
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    disposePool();
    process.exit(0);
  });
  process.on('uncaughtException', (error) => {
    log(`uncaught: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
  process.on('unhandledRejection', (error) => {
    log(`unhandled: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });

  log(`ready · store ${storePath()} · ${TOOLS.length} tools`);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1] !== '' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) serve();
