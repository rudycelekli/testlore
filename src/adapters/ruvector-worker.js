import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { safePath } from '../files.js';
import { ruvectorSettings, featureVector } from './ruvector.js';

const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const CACHE = '.tddswarm/learning/ruvector', MAX_CACHE_BYTES = 16 * 1024 * 1024;
function verifyFile(file, max) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > max) throw new Error('ruvector-cache-corrupt');
  return fs.readFileSync(file);
}
function providerIdentity(root, embedding) {
  if (embedding.mode !== 'command') return { mode: 'feature-vectors', version: 1 };
  const localInputs = {};
  for (const arg of embedding.argv) {
    const target = path.resolve(root, arg);
    if (target.startsWith(path.resolve(root) + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) {
      const stat = fs.statSync(target);
      localInputs[arg] = stat.size <= 1024 * 1024 ? digest(fs.readFileSync(target)) : { size: stat.size, modified: stat.mtimeMs };
    }
  }
  return { ...embedding, localInputs };
}
function embeddings(root, texts, settings) {
  if (settings.embedding.mode === 'feature-vectors') return texts.map(text => featureVector(text, settings.dimensions));
  const command = settings.embedding.argv;
  const result = spawnSync(command[0], command.slice(1), { cwd: root, input: JSON.stringify({ schemaVersion: 1, dimensions: settings.dimensions, texts }), encoding: 'utf8', shell: false, timeout: Math.max(100, Math.floor(settings.timeoutMs / 2)), killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) throw new Error('ruvector-embedding-command-failed');
  let output;
  try { output = JSON.parse(result.stdout); } catch { throw new Error('ruvector-invalid-embedding-output'); }
  if (!output || output.schemaVersion !== 1 || !Array.isArray(output.vectors) || output.vectors.length !== texts.length || output.vectors.some(vector => !Array.isArray(vector) || vector.length !== settings.dimensions || vector.some(value => !Number.isFinite(value) || Math.abs(value) > 1000000) || Math.hypot(...vector) === 0)) throw new Error('ruvector-invalid-embedding-output');
  return output.vectors.map(vector => { const norm = Math.hypot(...vector); return vector.map(value => value / norm); });
}
async function main(request) {
  const root = fs.realpathSync(request.root), settings = ruvectorSettings(request.settings), entries = request.entries;
  if (!Array.isArray(entries) || !entries.length || entries.length > 200 || entries.some(entry => !/^[a-f0-9]{64}$/.test(entry.id) || typeof entry.text !== 'string' || entry.text.length > 14000) || typeof request.query !== 'string' || request.query.length > 4096) throw new Error('ruvector-invalid-request');
  const packagePath = path.join(root, 'node_modules/@ruvector/core/package.json');
  if (!fs.existsSync(packagePath)) throw new Error('ruvector-sdk-missing');
  const info = JSON.parse(verifyFile(packagePath, 128 * 1024));
  if (info.name !== '@ruvector/core' || typeof info.version !== 'string' || !/^[a-zA-Z0-9.+_-]{1,64}$/.test(info.version)) throw new Error('ruvector-sdk-invalid');
  const sdkPath = path.join(path.dirname(packagePath), info.main || 'index.js');
  const sdkHash = digest(verifyFile(sdkPath, 1024 * 1024));
  const key = digest({ schemaVersion: 1, dimensions: settings.dimensions, provider: providerIdentity(root, settings.embedding), sdkVersion: info.version, sdkHash, entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)) });
  const directory = safePath(root, CACHE), dbFile = safePath(root, `${CACHE}/vectors.db`), manifestFile = safePath(root, `${CACHE}/metadata.json`);
  let metadata, reused = false;
  if (fs.existsSync(manifestFile)) {
    metadata = JSON.parse(verifyFile(manifestFile, 128 * 1024));
    const { integrity, ...payload } = metadata;
    if (integrity !== digest(payload) || metadata.schemaVersion !== 1 || !Array.isArray(metadata.ids) || metadata.ids.length > 200 || !Number.isInteger(metadata.dbBytes) || metadata.dbBytes < 1 || metadata.dbBytes > MAX_CACHE_BYTES || !/^[a-f0-9]{64}$/.test(metadata.key) || !/^[a-f0-9]{64}$/.test(metadata.dbHash) || metadata.ids.some(id => !/^[a-f0-9]{64}$/.test(id)) || new Set(metadata.ids).size !== metadata.ids.length || fs.statSync(dbFile).size !== metadata.dbBytes || digest(verifyFile(dbFile, MAX_CACHE_BYTES)) !== metadata.dbHash) throw new Error('ruvector-cache-corrupt');
    reused = metadata.key === key && metadata.dimensions === settings.dimensions && metadata.ids.length === entries.length && entries.every(entry => metadata.ids.includes(entry.id));
  } else if (fs.existsSync(dbFile)) throw new Error('ruvector-cache-corrupt');
  const require = createRequire(path.join(root, 'package.json'));
  let sdk;
  try { sdk = require(sdkPath); } catch { throw new Error('ruvector-native-load-failed'); }
  const VectorDb = sdk.VectorDb;
  if (typeof VectorDb !== 'function') throw new Error('ruvector-sdk-api-mismatch');
  fs.mkdirSync(directory, { recursive: true });
  const working = reused ? dbFile : safePath(root, `${CACHE}/.build-${randomUUID()}.db`);
  let db;
  try {
    // The actual 0.1.32 native binding requires capitalized enum variants.
    db = new VectorDb({ dimensions: settings.dimensions, storagePath: working, distanceMetric: 'Cosine' });
    if (typeof db.insertBatch !== 'function' || typeof db.search !== 'function' || typeof db.len !== 'function') throw new Error('ruvector-sdk-api-mismatch');
    const vectors = embeddings(root, reused ? [request.query] : [...entries.map(entry => entry.text), request.query], settings);
    if (!reused) await db.insertBatch(entries.map((entry, index) => ({ id: entry.id, vector: new Float32Array(vectors[index]) })));
    if (await db.len() !== entries.length) throw new Error('ruvector-cache-scope-mismatch');
    const hits = await db.search({ vector: new Float32Array(vectors.at(-1)), k: entries.length, efSearch: Math.max(64, entries.length) });
    if (!Array.isArray(hits)) throw new Error('ruvector-sdk-api-mismatch');
    const raw = verifyFile(working, MAX_CACHE_BYTES);
    if (!reused) fs.renameSync(working, dbFile);
    fs.chmodSync(dbFile, 0o600);
    const payload = { schemaVersion: 1, key, dimensions: settings.dimensions, sdkVersion: info.version, ids: entries.map(entry => entry.id).sort(), dbBytes: raw.length, dbHash: digest(raw) };
    const temporary = safePath(root, `${CACHE}/.metadata-${randomUUID()}.json`);
    try { fs.writeFileSync(temporary, JSON.stringify({ ...payload, integrity: digest(payload) }), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, manifestFile); }
    finally { fs.rmSync(temporary, { force: true }); }
    return { ok: true, version: info.version, cache: reused ? 'reused' : 'built', hits: hits.map(hit => ({ id: hit.id, distance: hit.score })) };
  } finally { if (!reused) fs.rmSync(working, { force: true }); }
}

try {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error('ruvector-request-too-large'); }
  const result = await main(JSON.parse(input)); process.stdout.write(JSON.stringify(result));
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, reason: /^ruvector-[a-z-]+$/.test(error.message) ? error.message : 'ruvector-worker-failed' })); }
