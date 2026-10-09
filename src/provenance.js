import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serviceInputs } from './inputs.js';
import {captureConfigurationInputs} from './configuration-inputs.js';
import { git, listFiles, safePath } from './files.js';
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function boundRunnerIdentity(root, config, configurationInputs) {
  const dependencyState={};
  for(const file of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','pytest.ini','pyproject.toml','nx.json','MODULE.bazel','.bazelversion']){try{dependencyState[file]=digest(fs.readFileSync(safePath(root,file)));}catch{}}
  return digest({ ...(configurationInputs?{configurationInputs}:{}), integration:config.integration||null, discovery:config.discovery||null, runtimePolicy:config.runtime||null, dependencyState, actionEnvironment:process.env.TDDSWARM_ENVIRONMENT||'', nodeOptions: digest(config.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ''), runner: config.runner || ['node','--test','{files}'], adapter: config.adapter || 'node', environment: config.environment || {}, env: config.env || {}, node: process.version, platform: process.platform, arch: process.arch, nodeEnv: process.env.NODE_ENV || '', tz: process.env.TZ || '' });
}
export function runnerIdentity(root,config={}) {return boundRunnerIdentity(root,config,config.configurationInputs?.length?captureConfigurationInputs(root,config):undefined);}
function fingerprintParts(record){return {...(record.configurationInputs?{configurationInputs:record.configurationInputs}:{}),files:record.files,runner:record.runner,...(record.services===undefined?{}:{services:record.services})};}
export function snapshot(root, config = {}) {
  const files = {};
  for (const file of listFiles(root)) {
    if (file.startsWith('.tddswarm/') || file.startsWith('.firecrawl/')) continue;
    files[file] = digest(fs.readFileSync(safePath(root,file)));
  }
  let revision = null;
  try { revision = git(root,['rev-parse','HEAD']).trim(); } catch {}
  const configurationInputs=config.configurationInputs?.length?captureConfigurationInputs(root,config):undefined;
  const runner = boundRunnerIdentity(root,config,configurationInputs);
  const environment = { node: process.version, platform: os.platform(), arch: os.arch(), labels: config.environment || {} };
  const serviceState=serviceInputs(root,config);
  const services=serviceState.values;
  const record={schemaVersion:1,revision,runner,environment,services,serviceWarnings:serviceState.warnings,files,...(configurationInputs?{configurationInputs}:{})};
  return {...record,fingerprint:digest(fingerprintParts(record))};
}
export function freshness(record, current, { changed = [], allowChangedInputs = false } = {}) {
  if (!record || record.schemaVersion !== 1 || !record.files || Array.isArray(record.files) || typeof record.files !== 'object' || typeof record.runner !== 'string' || record.fingerprint !== digest(fingerprintParts(record))) return { fresh:false, reasons:['invalid-provenance'] };
  const reasons = [];
  if((record.configurationInputs?.warnings||[]).length||(current.configurationInputs?.warnings||[]).length)reasons.push('configuration-input-unavailable');
  if(digest(record.configurationInputs??null)!==digest(current.configurationInputs??null))reasons.push('configuration-inputs-changed');
  if((record.serviceWarnings||[]).length||(current.serviceWarnings||[]).length)reasons.push('service-version-unavailable');
  if(digest(record.services||{})!==digest(current.services||{}))reasons.push('service-versions-changed');
  if (record.runner !== current.runner) reasons.push('runner-or-environment-changed');
  const allowed = new Set(allowChangedInputs ? changed : []);
  for (const file of new Set([...Object.keys(record.files),...Object.keys(current.files)])) {
    if (!allowed.has(file) && record.files[file] !== current.files[file]) reasons.push(`source-drift:${file}`);
  }
  return { fresh: !reasons.length, reasons };
}
