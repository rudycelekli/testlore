import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,commit,twoModules,write} from './helpers.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function invoke(root,...args){const env={...process.env};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[cli,...args,'--root',root],{env,encoding:'utf8',timeout:120000});}

test('human first install leads with the actual fault and next action before detailed routing evidence',t=>{
 const root=fixture(t,twoModules);commit(root);write(root,'src/a.js','export const a=9;');
 const attempt=invoke(root,'setup','--verify','--no-ci');
 assert.equal(attempt.status,1,attempt.stderr);
 assert.match(attempt.stdout,/^## TestLore first-run summary/);
 assert.match(attempt.stdout,/Result: \*\*failed\*\*/);
 assert.match(attempt.stdout,/Failed: test\/a\.test\.js/);
 assert.match(attempt.stdout,/Next action:.*repair.*full suite/);
 assert.doesNotMatch(attempt.stdout,/TAP version|AssertionError|\| Test file \|/);
 const raw=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json')));
 assert.equal(raw.summary.verdict,'failed');assert.equal(raw.summary.cases.failed,1);
 assert.equal(raw.summary.files.observed,2);assert.equal(raw.summary.files.actualOmissions,0);
 assert.equal(raw.shadow,true);
 const detail=fs.readFileSync(path.join(root,'.tddswarm/last-run.md'),'utf8');
 assert.ok(detail.indexOf('Next action:')<detail.indexOf('| Test file |'));
 assert.match(detail,/\| Test file \|/);
});
test('JSON setup and subsequent run keep the same durable diagnosis and original native assertions',t=>{
 const root=fixture(t,twoModules);commit(root);
 const setup=invoke(root,'setup','--verify','--no-ci','--json');assert.equal(setup.status,0,setup.stderr);
 const result=JSON.parse(setup.stdout);assert.deepEqual(result.summary,result.verification.summary);
 assert.equal(result.summary.verdict,'passed-in-observed-scope');assert.equal(result.summary.authority.measuredSavings,'not-established');
 write(root,'src/b.js','export const b=99;');
 const run=invoke(root,'run','--json');assert.equal(run.status,1,run.stderr);
 const report=JSON.parse(run.stdout),durable=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json')));
 assert.deepEqual(report.summary,durable.summary);assert.equal(report.summary.failedCases[0].file,'test/b.test.js');
 assert.equal(report.summary.cases.passed,1);assert.equal(report.summary.cases.failed,1);
 assert.match(fs.readFileSync(path.join(root,'test/b.test.js'),'utf8'),/assert.equal\(b,2\)/);
 const human=invoke(root,'run');assert.equal(human.status,1,human.stderr);assert.match(human.stdout,/^## TestLore first-run summary/);
});
test('setup without verification plainly discloses that no tests executed and leaves no run receipt',t=>{
 const root=fixture(t,twoModules);commit(root);
 const attempt=invoke(root,'setup','--no-ci');assert.equal(attempt.status,0,attempt.stderr);
 assert.match(attempt.stdout,/No tests executed/);assert.match(attempt.stdout,/setup --verify/);
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/last-run.json')),false);
});
