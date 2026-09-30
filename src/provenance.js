import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serviceInputs } from './inputs.js';
import { git, listFiles, safePath } from './files.js';
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function runnerIdentity(root, config = {}) {
  const dependencyState={};
  for(const file of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','pytest.ini','pyproject.toml','nx.json','MODULE.bazel','.bazelversion']){try{dependencyState[file]=digest(fs.readFileSync(safePath(root,file)));}catch{}}
  return digest({ integration:config.integration||null, discovery:config.discovery||null, runtimePolicy:config.runtime||null, dependencyState, actionEnvironment:process.env.TDDSWARM_ENVIRONMENT||'', runner: config.runner || ['node','--test','{files}'], adapter: config.adapter || 'node', environment: config.environment || {}, env: config.env || {}, node: process.version, platform: process.platform, arch: process.arch, nodeEnv: process.env.NODE_ENV || '', tz: process.env.TZ || '' });
}
export function snapshot(root, config = {}) {
  const files = {};
  for (const file of listFiles(root)) {
    if (file.startsWith('.tddswarm/') || file.startsWith('.firecrawl/')) continue;
    files[file] = digest(fs.readFileSync(safePath(root,file)));
  }
  let revision = null;
  try { revision = git(root,['rev-parse','HEAD']).trim(); } catch {}
  const runner = runnerIdentity(root,config);
  const environment = { node: process.version, platform: os.platform(), arch: os.arch(), labels: config.environment || {} };
  const serviceState=serviceInputs(root,config);
  const services=serviceState.values;
  return { schemaVersion: 1, revision, runner, environment, services, serviceWarnings:serviceState.warnings, files, fingerprint: digest({files,runner,services}) };
}
export function freshness(record, current, { changed = [], allowChangedInputs = false } = {}) {
  if (!record || record.schemaVersion !== 1 || !record.files || Array.isArray(record.files) || typeof record.files !== 'object' || typeof record.runner !== 'string' || record.fingerprint !== digest(record.services===undefined?{files:record.files,runner:record.runner}:{files:record.files,runner:record.runner,services:record.services})) return { fresh:false, reasons:['invalid-provenance'] };
  const reasons = [];
  if((record.serviceWarnings||[]).length||(current.serviceWarnings||[]).length)reasons.push('service-version-unavailable');
  if(digest(record.services||{})!==digest(current.services||{}))reasons.push('service-versions-changed');
  if (record.runner !== current.runner) reasons.push('runner-or-environment-changed');
  const allowed = new Set(allowChangedInputs ? changed : []);
  for (const file of new Set([...Object.keys(record.files),...Object.keys(current.files)])) {
    if (!allowed.has(file) && record.files[file] !== current.files[file]) reasons.push(`source-drift:${file}`);
  }
  return { fresh: !reasons.length, reasons };
}
