import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,commit,twoModules} from './helpers.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function setup(root,extra=[]){const env={...process.env};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,[cli,'setup','--root',root,'--no-ci','--json',...extra],{env,encoding:'utf8',timeout:20000});}
test('one-command verification immediately records real full shadow evidence and preserves failure exits',t=>{
 const root=fixture(t,twoModules);commit(root);
 fs.writeFileSync(path.join(root,'src/a.js'),'export const a = 999;');
 const attempt=setup(root,['--verify']);assert.equal(attempt.status,1,attempt.stderr);
 const result=JSON.parse(attempt.stdout),report=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/last-run.json')));
 assert.equal(result.verification.complete,true);assert.equal(result.verification.shadow,true);assert.equal(result.verification.tests.length,2);
 assert.equal(result.verification.tests.filter(t=>t.status==='failed').length,1);assert.equal(result.verification.tests.filter(t=>t.status==='passed').length,1);
 assert.equal(report.exitCode,1);assert.equal(report.shadow,true);assert.equal(result.verification.plan.decisions.length,2);
 assert.ok(result.next.includes('testlore report'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))).executionMode,'shadow');
});
test('ordinary setup remains runner-free and verification cannot silently mean selective execution',t=>{
 const root=fixture(t,{...twoModules,'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'-e',"require('node:fs').writeFileSync('runner-started','yes')",'{files}']}});commit(root);
 const attempt=setup(root);assert.equal(attempt.status,0,attempt.stderr);assert.equal(JSON.parse(attempt.stdout).verification,undefined);assert.equal(fs.existsSync(path.join(root,'runner-started')),false);
 const invalid=setup(root,['--verify','--selective']);assert.equal(invalid.status,2);assert.match(invalid.stderr,/full shadow/);assert.equal(fs.existsSync(path.join(root,'runner-started')),false);
 const misuse=spawnSync(process.execPath,[cli,'plan','--verify','--root',root],{encoding:'utf8'});assert.equal(misuse.status,2);assert.match(misuse.stderr,/only to setup/);
});
