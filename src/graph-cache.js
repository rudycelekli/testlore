import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safePath } from './files.js';

const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const ANALYSIS_CACHE_IMPLEMENTATION = digest(fs.readFileSync(fileURLToPath(import.meta.url)));
const DIRECTORY = '.tddswarm/analysis-cache/v1', MAX_SOURCE_BYTES = 4 * 1024 * 1024, MAX_ENTRY_BYTES = 128 * 1024;
const WARNING_KINDS = new Set(['parse-error','dynamic-dependency','runtime-registration','runtime-dependency']);

export function analysisCacheSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['enabled','maxEntries','maxBytes'].includes(key))) throw new Error('Invalid analysisCache settings');
  const enabled = value.enabled === true, maxEntries = value.maxEntries ?? 2000, maxBytes = value.maxBytes ?? 32 * 1024 * 1024;
  if ((value.enabled !== undefined && typeof value.enabled !== 'boolean') || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000 || !Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 64 * 1024 * 1024) throw new Error('Invalid analysisCache bounds');
  return { enabled, maxEntries, maxBytes };
}
function validResult(value) {
  return value && typeof value === 'object' && Object.keys(value).length === 2 && Array.isArray(value.imports) && value.imports.length <= 4096 && value.imports.every(spec => typeof spec === 'string' && spec.length <= 4096) && new Set(value.imports).size === value.imports.length && Array.isArray(value.warnings) && value.warnings.every(reason => WARNING_KINDS.has(reason)) && new Set(value.warnings).size === value.warnings.length;
}

function readBounded(target, maximum) {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw new Error('Invalid cache file size');
    const bytes = Buffer.alloc(stat.size + 1); let length = 0;
    for (let count; length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length, null));) length += count;
    if (length > stat.size) throw new Error('Cache file grew during read');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

function copy(value) { return { imports: [...value.imports], warnings: [...value.warnings] }; }

/** Cache summaries, never ASTs, resolved edges, discovery, or uncertainty decisions. */
export function createAnalysisCache(root, value, engine) {
  const settings = analysisCacheSettings(value);
  if (typeof engine !== 'string' || !/^[a-f0-9]{64}$/.test(engine)) throw new Error('Invalid analysis cache engine identity');
  const stats = { enabled: settings.enabled, engine, memoryHits: 0, diskHits: 0, parses: 0, writes: 0, corruptions: 0, evictions: 0, skipped: 0, unavailable: false };
  const memory = new Map(), pending = new Map(); let memoryBytes = 0, pendingBytes = 0;
  function remember(key, result) {
    const size = Buffer.byteLength(JSON.stringify(result));
    if (size > settings.maxBytes || memory.has(key)) return;
    while (memory.size >= settings.maxEntries || memoryBytes + size > settings.maxBytes) { const [old, entry] = memory.entries().next().value; memory.delete(old); memoryBytes -= entry.size; }
    memory.set(key, { result: copy(result), size }); memoryBytes += size;
  }
  function analyze(file, text, compute) {
    const sourceHash = digest(text), key = digest({ schemaVersion: 1, engine, file, sourceHash });
    const cached = memory.get(key);
    if (cached) { stats.memoryHits++; return copy(cached.result); }
    let cacheable = Buffer.byteLength(text) <= MAX_SOURCE_BYTES;
    try { if (root) safePath(root, file); } catch { cacheable = false; }
    if (settings.enabled && root && cacheable) {
      try {
        const target = safePath(root, `${DIRECTORY}/${key}.json`);
        if (fs.existsSync(target)) {
          const bytes = readBounded(target, MAX_ENTRY_BYTES);
          const record = JSON.parse(bytes), { integrity, ...payload } = record;
          if (Object.keys(record).some(field => !['schemaVersion','engine','key','file','sourceHash','result','integrity'].includes(field)) || integrity !== digest(payload) || record.schemaVersion !== 1 || record.engine !== engine || record.key !== key || record.file !== file || record.sourceHash !== sourceHash || !validResult(record.result)) throw new Error('Invalid cache summary');
          remember(key, record.result); stats.diskHits++; return copy(record.result);
        }
      } catch { stats.corruptions++; }
    }
    const result = compute(file, text); stats.parses++;
    const summary = copy(result);
    if (validResult(summary)) {
      remember(key, summary);
      if (settings.enabled && root && cacheable) {
        const payload = { schemaVersion: 1, engine, key, file, sourceHash, result: summary };
        const bytes = Buffer.from(JSON.stringify({ ...payload, integrity: digest(payload) }));
        if (bytes.length <= Math.min(MAX_ENTRY_BYTES, settings.maxBytes) && pending.size < settings.maxEntries && pendingBytes + bytes.length <= settings.maxBytes) { pending.set(key, bytes); pendingBytes += bytes.length; }
        else stats.skipped++;
      }
    } else stats.skipped++;
    return summary;
  }
  function flush() {
    if (!settings.enabled || !root) return;
    if (!pending.size) { try { if (!fs.existsSync(safePath(root, DIRECTORY))) return; } catch { stats.unavailable = true; return; } }
    let lock, token;
    try {
      const directory = safePath(root, DIRECTORY); fs.mkdirSync(directory, { recursive: true });
      lock = safePath(root, `${DIRECTORY}/.lock`); token = randomUUID();
      try { fs.writeFileSync(lock, JSON.stringify({ token, pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
      catch { token = null; stats.unavailable = true; return; }
      const entries = [], extras = [];
      let count = 0;
      const stream = fs.opendirSync(directory);
      try {
        for (let entry; (entry = stream.readSync());) {
          if (++count > settings.maxEntries * 2 + 100) throw new Error('Cache directory exceeds inventory bound');
          if (entry.name === '.lock') continue;
          const target = safePath(root, `${DIRECTORY}/${entry.name}`);
          if (!entry.isFile()) throw new Error('Unsafe cache directory entry');
          const stat = fs.statSync(target);
          if (/^[a-f0-9]{64}\.json$/.test(entry.name)) entries.push({ name: entry.name, target, bytes: stat.size, modified: stat.mtimeMs });
          else if (/^\.[a-f0-9]{64}-[a-f0-9-]+\.tmp$/.test(entry.name)) extras.push(target);
          else throw new Error('Unknown cache directory entry');
        }
      } finally { stream.closeSync(); }
      for (const target of extras) fs.rmSync(target, { force: true }); // Lock excludes another live writer.
      entries.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name));
      let bytes = entries.reduce((sum, item) => sum + item.bytes, 0);
      function evict(item) { fs.rmSync(item.target, { force: true }); bytes -= item.bytes; stats.evictions++; }
      for (const [key, data] of pending) {
        const name = `${key}.json`, existing = entries.findIndex(item => item.name === name);
        if (existing >= 0) evict(entries.splice(existing, 1)[0]);
        while (entries.length && (entries.length >= settings.maxEntries || bytes + data.length > settings.maxBytes)) evict(entries.shift());
        const target = safePath(root, `${DIRECTORY}/${name}`), temporary = safePath(root, `${DIRECTORY}/.${key}-${randomUUID()}.tmp`);
        try { fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 }); safePath(root, `${DIRECTORY}/${name}`); fs.renameSync(temporary, target); }
        finally { fs.rmSync(temporary, { force: true }); }
        const stat = fs.statSync(target); entries.push({ name, target, bytes: data.length, modified: stat.mtimeMs }); bytes += data.length; stats.writes++;
      }
      while (entries.length > settings.maxEntries || bytes > settings.maxBytes) evict(entries.shift());
    } catch { stats.unavailable = true; }
    finally {
      pending.clear(); pendingBytes = 0;
      if (lock && token) { try { const target = safePath(root, `${DIRECTORY}/.lock`); if (JSON.parse(readBounded(target, 1024)).token === token) fs.rmSync(target, { force: true }); } catch {} }
    }
  }
  return { analyze, flush, stats };
}
