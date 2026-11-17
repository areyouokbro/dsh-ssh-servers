/**
 * Append-only operations journal.
 *
 * Every command, upload, download or probe that touches a real machine lands
 * here with who did it, what exactly ran, and how it ended. This is the
 * safety net behind "the agent should not cause an outage": a human can always
 * answer "what did it do to production at 03:12" from this file.
 *
 * Both processes write it (the panel through Host routes, the agent through
 * MCP), so writes are single-line appends and reads tolerate a torn tail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pluginDataDir } from './store.js';

const MAX_ENTRIES = 20000;
const PREVIEW_CHARS = 2000;

export function journalPath() {
  return path.join(pluginDataDir(), 'journal.jsonl');
}

/**
 * Commands that can end a service, a filesystem or a box. Kept deliberately
 * broad: a false positive costs a red badge, a false negative costs an outage.
 */
const RISK_RULES = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, label: 'recursive delete' },
  { pattern: /\bmkfs(\.\w+)?\b/, label: 'format filesystem' },
  { pattern: /\bdd\s+.*\bof=\/dev\//, label: 'raw device write' },
  { pattern: /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/, label: 'power state change' },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\b/, label: 'stop/disable service' },
  { pattern: /\bservice\s+\S+\s+stop\b/, label: 'stop service' },
  { pattern: /\b(kill|pkill|killall)\s+-9\b/, label: 'force kill' },
  { pattern: /\biptables\s+-F\b|\bnft\s+flush\b|\bufw\s+disable\b/, label: 'flush firewall' },
  { pattern: /\bchmod\s+(-R\s+)?777\b/, label: 'world-writable' },
  { pattern: /\bchown\s+-R\b/, label: 'recursive ownership change' },
  { pattern: /(?:^|[^0-9&])>{1,2}\s*\/(etc|var|usr|boot|opt)\//, label: 'write into a system path' },
  { pattern: /\bdrop\s+(database|table)\b/i, label: 'drop database object' },
  { pattern: /\btruncate\s+table\b/i, label: 'truncate table' },
  { pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/, label: 'discard working tree' },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, label: 'remove containers/images' },
];

export function detectRisk(command) {
  if (typeof command !== 'string' || command.trim() === '') return [];
  const hits = [];
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(command)) hits.push(rule.label);
  }
  return hits;
}

function clip(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.length <= PREVIEW_CHARS ? trimmed : `${trimmed.slice(0, PREVIEW_CHARS)}…[truncated]`;
}

/**
 * @param {object} entry
 * @param {string} entry.serverId
 * @param {string} entry.server
 * @param {string} [entry.group]
 * @param {string} [entry.groupName]
 * @param {string} entry.action  exec | upload | download | mkdir | probe | connect
 * @param {string} entry.actor   agent | panel
 * @param {string} [entry.command]
 * @param {string} [entry.path]
 * @param {number} [entry.bytes]
 * @param {number|null} [entry.exitCode]
 * @param {number} [entry.durationMs]
 * @param {string} [entry.stdout]
 * @param {string} [entry.stderr]
 * @param {boolean} [entry.ok]
 * @param {string} [entry.note]
 */
export function appendJournal(entry) {
  const record = {
    at: new Date().toISOString(),
    serverId: String(entry.serverId ?? ''),
    server: String(entry.server ?? ''),
    group: String(entry.group ?? ''),
    groupName: String(entry.groupName ?? ''),
    action: String(entry.action ?? 'exec'),
    actor: entry.actor === 'panel' ? 'panel' : 'agent',
    command: typeof entry.command === 'string' ? entry.command : '',
    path: typeof entry.path === 'string' ? entry.path : '',
    bytes: Number.isFinite(Number(entry.bytes)) ? Number(entry.bytes) : 0,
    exitCode: entry.exitCode === undefined ? null : entry.exitCode,
    durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : 0,
    stdout: clip(entry.stdout),
    stderr: clip(entry.stderr),
    ok: entry.ok !== false,
    risk: detectRisk(entry.command),
    note: typeof entry.note === 'string' ? entry.note : '',
  };
  try {
    const file = journalPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    trimIfNeeded(file);
  } catch {
    // A journal write must never fail the operation it is recording.
  }
  return record;
}

/** Keep the file bounded without rewriting it on every append. */
function trimIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < 8 * 1024 * 1024) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    const kept = lines.slice(-MAX_ENTRIES);
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${kept.join('\n')}\n`, 'utf8');
    fs.renameSync(temp, file);
  } catch {
    /* trimming is opportunistic */
  }
}

/**
 * Newest-first slice of the journal.
 * @param {{serverId?: string, group?: string, actor?: string, limit?: number, riskyOnly?: boolean}} filter
 */
export function readJournal(filter = {}) {
  const limit = Math.min(2000, Math.max(1, Number(filter.limit) || 100));
  let text;
  try {
    text = fs.readFileSync(journalPath(), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn tail from a concurrent append
    }
    if (filter.serverId !== undefined && filter.serverId !== '' && record.serverId !== filter.serverId) continue;
    if (filter.group !== undefined && filter.group !== '' && record.group !== filter.group) continue;
    if (filter.actor !== undefined && filter.actor !== '' && record.actor !== filter.actor) continue;
    if (filter.riskyOnly === true && !(Array.isArray(record.risk) && record.risk.length > 0)) continue;
    out.push(record);
    if (out.length >= limit) break;
  }
  return out;
}

/** Counts used by the panel's overview and by `ssh_brief`. */
export function journalSummary(filter = {}) {
  const recent = readJournal({ ...filter, limit: 500 });
  let risky = 0;
  let failed = 0;
  for (const record of recent) {
    if (Array.isArray(record.risk) && record.risk.length > 0) risky += 1;
    if (record.ok === false) failed += 1;
  }
  return {
    sampled: recent.length,
    risky,
    failed,
    last: recent[0] ?? null,
  };
}

/** Only successful changes matter for "what did we already do here". */
export function notableHistory(serverId, limit = 8) {
  return readJournal({ serverId, limit: limit * 3 })
    .filter((record) => record.action !== 'probe' && record.command !== '')
    .slice(0, limit);
}
