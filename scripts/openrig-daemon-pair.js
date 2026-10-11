import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertFreshOutput, validateDaemonPair } from './openrig-defect-pilot.js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--baseline', '--fixed', '--output', '--producer-sha', '--run-id', '--run-attempt'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('Use explicit baseline/fixed/output artifact directories and producer binding');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
if (!args.baseline || !args.fixed || !args.output) throw new Error('Missing paired daemon artifacts');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' });
if (head.status !== 0) throw new Error('Producer Git revision unavailable');
const producer = {
  revision: args['producer-sha'] || head.stdout.trim(),
  repository: 'rudycelekli/testlore',
  runId: args['run-id'] || process.env.GITHUB_RUN_ID,
  runAttempt: args['run-attempt'] || process.env.GITHUB_RUN_ATTEMPT,
};
if (!/^[a-f0-9]{40}$/.test(producer.revision) || !/^[1-9][0-9]*$/.test(producer.runId || '') || !/^[1-9][0-9]*$/.test(producer.runAttempt || '')) throw new Error('Missing exact producer/head/run binding');
if (producer.revision !== head.stdout.trim()) throw new Error('Explicit producer SHA differs from the actual checkout HEAD');
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'benchmarks/openrig-tab-fence/manifest.json')));
const result = validateDaemonPair(args.baseline, args.fixed, producer, manifest);
const output = path.resolve(args.output); assertFreshOutput(output); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'paired-assessment.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, legQualified: result.legQualified, qualified: false, omissionAuthority: false, output }));
