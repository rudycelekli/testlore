import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture, twoModules, commit} from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const command = (root, name, args = []) => spawnSync(process.execPath, [cli, name, '--root', root, ...args, '--json'], {encoding: 'utf8'});

test('evidence-loop CLI rejects unrelated authority and execution flags before writes', t => {
  const root = fixture(t);
  for (const [name, args] of [
    ['observe', ['--revision', 'declared', '--selective']],
    ['loop-status', ['--execute']],
    ['challenge', ['--id', 'uuid', '--claim', 'deployment-safe', '--trusted-key', 'key.pem', '--full']],
    ['outcome', ['--id', 'uuid', '--claim', 'observed-pass', '--verdict', 'accepted', '--reviewer', 'operator', '--trusted-key', 'key.pem', '--shadow']]
  ]) {
    const result = command(root, name, args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /does not apply/);
  }
  const deadline = command(root, 'observe', ['--revision', 'declared', '--deadline-ms', 'NaN']);
  assert.equal(deadline.status, 2);
  assert.match(deadline.stderr, /positive integer/);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false);
});

test('unsigned loop inspection fails closed without executing configured project code', t => {
  const root = fixture(t, {'tddswarm.config.json': {runner: [process.execPath, '-e', "require('fs').writeFileSync('ran', 'yes')"]}});
  const result = command(root, 'loop-status');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.equal(fs.existsSync(path.join(root, 'ran')), false);
  assert.equal(fs.existsSync(path.join(root, '.tddswarm')), false);
});

test('CLI exports trust and checkpoint outside the project without overwriting either', t => {
  const root = fixture(t, twoModules);
  commit(root);
  const trust = fixture(t);
  const key = path.join(trust, 'recorder.pem');
  const checkpoint = path.join(trust, 'checkpoint.json');
  const init = command(root, 'witness-init', ['--output', key]);
  assert.equal(init.status, 0, init.stderr);
  assert.match(fs.readFileSync(key, 'utf8'), /BEGIN PUBLIC KEY/);
  const observe = command(root, 'observe', ['--revision', 'operator-declared', '--base', 'HEAD', '--output', checkpoint]);
  assert.equal(observe.status, 0, observe.stderr + observe.stdout);
  const observation = JSON.parse(observe.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(checkpoint, 'utf8')), observation.checkpoint);
  const inspected = command(root, 'loop-status', ['--trusted-key', key, '--checkpoint', checkpoint]);
  assert.equal(inspected.status, 0, inspected.stderr + inspected.stdout);
  assert.equal(JSON.parse(inspected.stdout).authority, 'historical-observation-only');
  const journal = path.join(root, '.tddswarm/loop/journal.jsonl');
  fs.writeFileSync(path.join(root, 'sentinel.cjs'), "require('fs').writeFileSync('ran', 'yes');");
  fs.writeFileSync(path.join(root, 'tddswarm.config.json'), JSON.stringify({runner: [process.execPath, 'sentinel.cjs', '{files}']}));
  const beforeChallenge = fs.readFileSync(journal, 'utf8');
  const challenged = command(root, 'challenge', ['--id', observation.id, '--claim', 'observed-pass', '--trusted-key', key, '--checkpoint', checkpoint]);
  assert.equal(challenged.status, 0, challenged.stderr + challenged.stdout);
  assert.equal(JSON.parse(challenged.stdout).supported, true);
  const unsafe = command(root, 'challenge', ['--id', observation.id, '--claim', 'deployment-safe', '--trusted-key', key]);
  assert.equal(unsafe.status, 1, unsafe.stderr + unsafe.stdout);
  assert.equal(fs.readFileSync(journal, 'utf8'), beforeChallenge);
  const reviewed = command(root, 'outcome', ['--id', observation.id, '--claim', 'observed-pass', '--verdict', 'accepted', '--reviewer', 'local operator', '--trusted-key', key, '--checkpoint', checkpoint]);
  assert.equal(reviewed.status, 0, reviewed.stderr + reviewed.stdout);
  assert.equal(JSON.parse(reviewed.stdout).reviewerIdentity, 'operator-asserted-not-verified');
  const beforeRecall = fs.readFileSync(journal, 'utf8');
  const recalled = command(root, 'outcome-lessons', ['--query', 'observed-pass', '--trusted-key', key]);
  assert.equal(recalled.status, 0, recalled.stderr + recalled.stdout);
  assert.equal(JSON.parse(recalled.stdout).lessons.length, 1, recalled.stdout);
  assert.equal(JSON.parse(recalled.stdout).authority, 'none');
  assert.equal(fs.readFileSync(journal, 'utf8'), beforeRecall);
  assert.equal(fs.existsSync(path.join(root, 'ran')), false);
  const previous = fs.readFileSync(checkpoint, 'utf8');
  const rejected = command(root, 'observe', ['--revision', 'second', '--output', checkpoint]);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /already exists/);
  assert.equal(fs.readFileSync(checkpoint, 'utf8'), previous);
  const initAgain = command(root, 'witness-init', ['--output', key]);
  assert.equal(initAgain.status, 2);
});

test('observe preserves a failing native runner exit and records the historical failure', t => {
  const root = fixture(t, {...twoModules, 'src/a.js': 'export const a=9;'});
  commit(root);
  const trust = fixture(t);
  const key = path.join(trust, 'recorder.pem');
  assert.equal(command(root, 'witness-init', ['--output', key]).status, 0);
  const result = command(root, 'observe', ['--revision', 'declared-failing', '--base', 'HEAD']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const observation = JSON.parse(result.stdout);
  assert.equal(observation.status, 'failed');
  const challenged = command(root, 'challenge', ['--id', observation.id, '--claim', 'observed-pass', '--trusted-key', key]);
  assert.equal(challenged.status, 1, challenged.stderr + challenged.stdout);
  assert.equal(JSON.parse(challenged.stdout).supported, false);
});
