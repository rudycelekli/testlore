import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, twoModules } from './helpers.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const exec = (root,args) => spawnSync('node',[cli,...args],{cwd:root,encoding:'utf8'});
test('initialization is useful without tests, ignores local artifacts, and preserves config', t => {
  const root = fixture(t, { 'src/a.js': 'export const a=1;' });
  const initial = exec(root,['init','--json']);
  assert.equal(initial.status,0);
  const report = JSON.parse(initial.stdout);
  assert.equal(report.created,true); assert.equal(report.report.grade,'ungraded');
  assert.ok(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('.tddswarm/'));
  const before = fs.readFileSync(path.join(root,'tddswarm.config.json'),'utf8');
  const again = exec(root,['init','--json']);
  assert.equal(JSON.parse(again.stdout).created,false);
  assert.equal(fs.readFileSync(path.join(root,'tddswarm.config.json'),'utf8'),before);
});
test('CLI run does not accept incomplete manually supplied changes', t => {
  const result = exec(fixture(t,twoModules),['run','--changed','src/a.js']);
  assert.equal(result.status,2); assert.match(result.stderr,/diagnostic only/);
});
test('CLI JSON runner failure remains a nonzero process exit', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js':'export const a=9;' });
  const result = exec(root,['run','--full','--json']);
  assert.equal(result.status,1); assert.equal(JSON.parse(result.stdout).exitCode,1);
});
test('npm-style symlinked bin entrypoints actually execute the CLI', t => {
  const root = fixture(t);
  const bin = path.join(root,'tddswarm');
  fs.symlinkSync(cli,bin);
  const result = spawnSync('node',[bin,'--version'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0); assert.equal(result.stdout.trim(),'0.1.0');
});
