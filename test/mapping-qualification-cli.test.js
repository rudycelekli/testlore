import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,write,twoModules} from './helpers.js';
import {snapshot} from '../src/provenance.js';
import {readConfig} from '../src/files.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function call(root,args){return spawnSync(process.execPath,[cli,'mapping-qualify','--root',root,...args],{encoding:'utf8',timeout:30000});}
function proposal(root){return {schemaVersion:1,applied:false,stable:true,truncated:false,provenance:snapshot(root,readConfig(root)),proposals:[{authority:'proposal-only',status:'review-required',patch:{dependencies:{'test/a.test.js':['src/a.js']}}}]};}
test('mapping CLI requires explicit execution and rejects unrelated options before native code',t=>{
  const root=fixture(t,{'test/sentinel.test.js':"import fs from 'node:fs';fs.writeFileSync('executed','yes');"});
  assert.equal(call(root,['--report','missing.json','--changed','src/a.js']).status,2);
  assert.match(call(root,['--execute','--report','missing.json','--changed','src/a.js','--selective']).stderr,/accepts only/);
  assert.equal(fs.existsSync(path.join(root,'executed')),false);
});
test('mapping CLI independently executes the proposed scope and leaves declarations unapplied',t=>{
  const root=fixture(t,twoModules),config=readConfig(root);write(root,'.tddswarm/proposal.json',proposal(root));
  const r=call(root,['--report','.tddswarm/proposal.json','--changed','src/a.js','--execute','--json']);
  assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.qualified,true);assert.equal(report.full.tests.length,2);assert.equal(report.subset.tests.length,1);assert.equal(report.applied,false);assert.equal(report.closedWorld,false);assert.deepEqual(readConfig(root),config);
});
test('mapping CLI surfaces native reporting failure as incomplete',t=>{
  const root=fixture(t,{...twoModules,'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'-e','process.exit(0)','{files}']}});write(root,'.tddswarm/proposal.json',proposal(root));
  const r=call(root,['--report','.tddswarm/proposal.json','--changed','src/a.js','--execute','--json']);
  assert.equal(r.status,2,r.stderr);assert.equal(JSON.parse(r.stdout).conservativeFallback.required,true);
});
