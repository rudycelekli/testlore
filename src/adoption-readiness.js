import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {safePath, validateConfig} from './files.js';
import {adapterFor} from './execution.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 128 * 1024;
function readJson(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('metadata-byte-or-file-budget');
    const buffer = Buffer.alloc(stat.size + 1); let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count;
    if (length !== stat.size || length > MAX_BYTES) throw new Error('metadata-changed-during-read');
    const bytes = buffer.subarray(0, length), value = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-json-object');
    return {value, sha256: hash(bytes)};
  } finally {fs.closeSync(fd);}
}

function installedPackage(root, name) {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const filename = fs.realpathSync(require.resolve(name + '/package.json'));
    const {value, sha256} = readJson(filename);
    if (value.name !== name || typeof value.version !== 'string' || value.version.length > 80 || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(value.version)) throw new Error('package-identity-invalid');
    return {name, installed: true, version: value.version, manifestSha256: sha256, codeExecuted: false};
  } catch {return {name, installed: false, version: null, codeExecuted: false, reason: 'package-metadata-unavailable-or-invalid'};}
}

/** Inspect prerequisites only. Do not import SDKs, discover tests, probe services or run commands. */
export function adoptionReadiness(root) {
  root = fs.realpathSync(root);
  if (!fs.statSync(root).isDirectory()) throw new Error('Project root must be a directory');
  const checks = [];
  const add = (id, status, reason, nextAction) => checks.push({id, status, reason, nextAction});
  const [major, minor] = process.versions.node.split('.').map(Number);
  add('node-runtime', major > 22 || major === 22 && minor >= 19 ? 'observed' : 'blocked',
    'Observed Node ' + process.versions.node + '; installed runner compatibility still requires execution.', 'Use Node 22.19 or newer supported by the project runner.');
  let config = {}, configuration = {present: false, valid: false, sha256: null};
  try {
    const filename = safePath(root, 'tddswarm.config.json');
    configuration.present = fs.existsSync(filename);
    if (configuration.present) {
      const input = readJson(filename); config = validateConfig(input.value);
      configuration = {present: true, valid: true, sha256: input.sha256};
    }
  } catch {configuration.valid = false; configuration.present = true;}
  add('configuration', configuration.valid ? 'observed' : 'blocked',
    configuration.present ? configuration.valid ? 'Configuration parsed without executing project code.' : 'Configuration is unsafe, invalid or exceeds the metadata budget.' : 'No TestLore configuration found.',
    configuration.present ? 'Review tddswarm.config.json; retain conservative policies.' : 'Run testlore setup, inspect and commit the generated configuration.');
  let adapter = null, backend = null;
  if (configuration.valid) {
    const requested = adapterFor(config);
    adapter = typeof requested === 'string' && ['node', 'vitest', 'jest', 'playwright', 'custom'].includes(requested) ? requested : 'custom';
    backend = typeof config.integration?.type === 'string' && /^[a-z-]{1,40}$/.test(config.integration.type) ? config.integration.type : config.integration ? 'custom' : null;
    add('shadow-policy', config.executionMode === 'shadow' ? 'observed' : 'review-required',
      config.executionMode === 'shadow' ? 'Shadow mode is configured.' : 'Shadow mode is not explicitly configured; current policy is preserved.',
      'Keep full CI execution and use testlore run --shadow --base YOUR_REVIEWED_BASE_COMMIT --json.');
  }
  const sdkName = {vitest: 'vitest', jest: 'jest', playwright: '@playwright/test'}[adapter];
  const sdk = sdkName ? installedPackage(root, sdkName) : null;
  if (sdk) add('native-sdk', sdk.installed ? 'observed' : 'blocked',
    sdk.installed ? 'Installed ' + sdk.name + ' metadata reports ' + sdk.version + '.' : 'Configured native SDK metadata cannot be resolved.',
    'Restore the project’s pinned dependencies with its package manager; TestLore does not download SDKs or browsers during inspection.');
  if (backend || adapter === 'custom') add('native-engine', 'review-required',
    'The configured external/custom engine needs independent native scope qualification.', 'Inspect its native prerequisites and run supervised full verification; static diagnostics cannot certify them.');
  let contract = false;
  try {const filename = safePath(root, 'tddswarm.requirements.md'), stat = fs.statSync(filename); contract = stat.isFile() && stat.size > 0 && stat.size <= 96 * 1024;} catch {}
  add('generation-contract', contract ? 'review-required' : 'missing',
    contract ? 'A bounded requirements file is present; independent expectations remain unverified.' : 'Generation needs independently reviewed behavioral requirements.',
    'Review tddswarm.requirements.md independently before invoking a generation worker. Routing can be evaluated without generation.');
  const blocked = checks.filter(row => row.status === 'blocked').map(row => row.id);
  return {schemaVersion: 1, kind: 'adoption-readiness', authority: 'static-prerequisites-only',
    projectCommandsInvoked: false, commandsExecuted: 0, configuration, adapter, backend, sdk,
    state: blocked.length ? 'blocked-on-prerequisites' : 'ready-for-shadow-attempt', blocked, checks,
    verification: {complete: false, nativeScopeEstablished: false, deploymentSafety: 'not-established', learningImprovement: 'not-established'},
    nextAction: blocked.length ? checks.find(row => row.status === 'blocked').nextAction : 'Execute testlore run --shadow --base YOUR_REVIEWED_BASE_COMMIT --json, then inspect testlore report.',
    limitations: ['Static prerequisites are not successful execution, a current native inventory or a routing qualification.', 'Package metadata does not attest installed runtime bytes, executable availability, browser installation or host permissions.', 'No credentials, environment values, runner arguments or project source are returned. npm ownership and publication are separate maintainer gates.']};
}
