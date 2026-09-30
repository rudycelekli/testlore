import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./ruvector-worker.js', import.meta.url));
export function ruvectorSettings(value = {}) {
  const dimensions = value.dimensions ?? 128, timeoutMs = value.timeoutMs ?? 10000;
  if (!Number.isInteger(dimensions) || dimensions < 16 || dimensions > 2048 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('ruvector-invalid-settings');
  const embedding = value.embedding || { mode: 'feature-vectors' };
  if (!['feature-vectors', 'command'].includes(embedding.mode)) throw new Error('ruvector-invalid-embedding-mode');
  if (embedding.mode === 'command' && (!Array.isArray(embedding.argv) || !embedding.argv.length || embedding.argv.length > 32 || embedding.argv.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || arg.includes('\0')) || typeof embedding.identity !== 'string' || !embedding.identity.trim() || embedding.identity.length > 128)) throw new Error('ruvector-invalid-embedding-command');
  return { dimensions, timeoutMs, embedding: embedding.mode === 'command' ? { mode: 'command', argv: embedding.argv, identity: embedding.identity } : { mode: 'feature-vectors' } };
}

/** Deterministic nonsemantic lexical features; native search stores actual vectors. */
export function featureVector(text, dimensions) {
  const vector = Array(dimensions).fill(0);
  const terms = [...new Set((text.toLowerCase().match(/[a-z0-9_]{2,40}/g) || []).filter(token => !['const','import','from','return','function','test','assert','node','the','and'].includes(token)))].slice(0, 512);
  for (const term of terms) {
    const hash = createHash('sha256').update(term).digest();
    vector[hash.readUInt32LE(0) % dimensions] += 1;
  }
  const norm = Math.hypot(...vector);
  return norm ? vector.map(value => value / norm) : vector;
}

/** Native code is confined to a bounded worker; canonical records authorize ids. */
export function ruvectorRecall(root, entries, query, settings) {
  try {
    if (settings?.enabled === false) return { used: false, reason: 'ruvector-disabled' };
    const normalized = ruvectorSettings(settings);
    if (!Array.isArray(entries) || entries.length > 200 || entries.some(entry => !/^[a-f0-9]{64}$/.test(entry.id) || typeof entry.text !== 'string' || entry.text.length > 14000) || typeof query !== 'string' || query.length > 4096) throw new Error('ruvector-invalid-request');
    if (!entries.length || !query.trim()) return { used: false, reason: 'ruvector-empty-scope-or-query' };
    if (normalized.embedding.mode === 'feature-vectors' && !featureVector(query, normalized.dimensions).some(value => value)) return { used: false, reason: 'ruvector-empty-feature-query' };
    // A project-local dependency may itself be symlinked into an improvement worktree.
    const packageFile = path.join(root, 'node_modules/@ruvector/core/package.json');
    if (!fs.existsSync(packageFile)) return { used: false, reason: 'ruvector-sdk-missing' };
    const input = JSON.stringify({ root: path.resolve(root), entries, query, settings: normalized });
    if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error('ruvector-request-too-large');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [worker], { cwd: root, input, encoding: 'utf8', env, shell: false, timeout: normalized.timeoutMs, killSignal: 'SIGKILL', detached: process.platform !== 'win32', maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) {
      if (result.pid && process.platform !== 'win32') { try { process.kill(-result.pid, 'SIGKILL'); } catch {} }
      return { used: false, reason: result.error?.code === 'ETIMEDOUT' ? 'ruvector-worker-timeout' : 'ruvector-worker-failed' };
    }
    let output;
    try { output = JSON.parse(result.stdout); } catch { return { used: false, reason: 'ruvector-invalid-worker-output' }; }
    if (!output.ok || !Array.isArray(output.hits) || output.hits.length > 200 || typeof output.version !== 'string') return { used: false, reason: /^ruvector-[a-z-]+$/.test(output.reason || '') ? output.reason : 'ruvector-invalid-worker-output' };
    const allowed = new Set(entries.map(entry => entry.id)), seen = new Set();
    const hits = output.hits.filter(hit => hit && allowed.has(hit.id) && !seen.has(hit.id) && Number.isFinite(hit.distance) && hit.distance >= -0.00001 && hit.distance <= 2.00001 && (seen.add(hit.id), true)).map(hit => ({ id: hit.id, similarity: Math.max(0, Math.min(1, 1 - hit.distance)) }));
    if (!hits.some(hit => hit.similarity > 0)) return { used: false, reason: 'ruvector-no-valid-hits' };
    return { used: true, hits, engine: '@ruvector/core', mode: normalized.embedding.mode === 'command' ? 'external-embedding' : 'lexical-vector', version: output.version.slice(0, 64), cache: output.cache === 'reused' ? 'reused' : 'built' };
  } catch (error) { return { used: false, reason: /^ruvector-[a-z-]+$/.test(error.message) ? error.message : 'ruvector-adapter-failed' }; }
}
