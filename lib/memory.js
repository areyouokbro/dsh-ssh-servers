/**
 * Tiered memory: one notebook per server, one per group.
 *
 * The point is not to log (the journal does that) but to carry forward what a
 * careful operator would have written on a sticky note: what this box is for,
 * which paths are load-bearing, what broke last time, what must not be touched.
 * The agent reads it before acting and appends to it after learning something.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pluginDataDir } from './store.js';

const MAX_FACTS = 300;
const MAX_WARNINGS = 150;
const MAX_TEXT = 4000;

function dirFor(scope) {
  const folder = scope === 'group' ? 'groups' : 'servers';
  return path.join(pluginDataDir(), 'memory', folder);
}

function fileFor(scope, id) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(dirFor(scope), `${safe}.json`);
}

function empty(scope, id) {
  return {
    scope: scope === 'group' ? 'group' : 'server',
    id: String(id),
    summary: '',
    facts: [],
    warnings: [],
    updatedAt: null,
  };
}

function normalizeEntry(entry) {
  const item = entry !== null && typeof entry === 'object' ? entry : {};
  return {
    at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
    text: String(item.text ?? '').slice(0, MAX_TEXT),
    by: item.by === 'user' ? 'user' : 'agent',
  };
}

function normalize(raw, scope, id) {
  const base = empty(scope, id);
  if (raw === null || typeof raw !== 'object') return base;
  return {
    ...base,
    summary: String(raw.summary ?? '').slice(0, MAX_TEXT),
    facts: Array.isArray(raw.facts) ? raw.facts.map(normalizeEntry).slice(-MAX_FACTS) : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(normalizeEntry).slice(-MAX_WARNINGS) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function readMemory(scope, id) {
  const file = fileFor(scope, id);
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')), scope, id);
  } catch {
    return empty(scope, id);
  }
}

export function writeMemory(memory) {
  const target = normalize(memory, memory.scope, memory.id);
  target.updatedAt = new Date().toISOString();
  const file = fileFor(target.scope, target.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(target, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return target;
}

/**
 * Append one fact or warning.
 * @param {'server'|'group'} scope
 * @param {string} id
 * @param {'fact'|'warning'} kind
 * @param {string} text
 * @param {'agent'|'user'} by
 */
export function addMemoryEntry(scope, id, kind, text, by) {
  const clean = String(text ?? '').trim();
  if (clean === '') throw new Error('memory text is required');
  const memory = readMemory(scope, id);
  const entry = { at: new Date().toISOString(), text: clean.slice(0, MAX_TEXT), by: by === 'user' ? 'user' : 'agent' };
  if (kind === 'warning') memory.warnings = [...memory.warnings, entry].slice(-MAX_WARNINGS);
  else memory.facts = [...memory.facts, entry].slice(-MAX_FACTS);
  return writeMemory(memory);
}

export function setMemorySummary(scope, id, summary) {
  const memory = readMemory(scope, id);
  memory.summary = String(summary ?? '').slice(0, MAX_TEXT);
  return writeMemory(memory);
}

/** Drop one entry by its index inside the chosen list, newest first. */
export function removeMemoryEntry(scope, id, kind, index) {
  const memory = readMemory(scope, id);
  const list = kind === 'warning' ? memory.warnings : memory.facts;
  const position = list.length - 1 - Number(index);
  if (!Number.isInteger(position) || position < 0 || position >= list.length) {
    throw new Error('memory entry not found');
  }
  list.splice(position, 1);
  return writeMemory(memory);
}

export function clearMemory(scope, id) {
  return writeMemory(empty(scope, id));
}

/** Compact text block for a prompt or a tool result. */
export function renderMemory(memory, heading) {
  const lines = [];
  const count = memory.facts.length + memory.warnings.length;
  if (memory.summary === '' && count === 0) return `${heading}\n(还没有记录 — nothing recorded yet)`;
  lines.push(heading);
  if (memory.summary !== '') lines.push(`summary: ${memory.summary}`);
  if (memory.warnings.length > 0) {
    lines.push('warnings (do not ignore):');
    for (const entry of memory.warnings.slice(-8)) lines.push(`  ! ${entry.text}`);
  }
  if (memory.facts.length > 0) {
    lines.push('facts:');
    for (const entry of memory.facts.slice(-12)) lines.push(`  - ${entry.text}`);
  }
  return lines.join('\n');
}

export function memoryStats(scope, id) {
  const memory = readMemory(scope, id);
  return {
    facts: memory.facts.length,
    warnings: memory.warnings.length,
    hasSummary: memory.summary !== '',
    updatedAt: memory.updatedAt,
  };
}
