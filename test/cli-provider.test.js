import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,commit,git,twoModules} from './helpers.js';

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
test('explicit generation author choice is inspectable without executing a worker or changing project policy',t=>{
 const root=fixture(t,{...twoModules,'tddswarm.config.json':{adapter:'node',plugins:{'agentic-qe':{enabled:true}}}});commit(root);
 const result=spawnSync(process.execPath,[cli,'generate','--root',root,'--provider','json-worker','--json'],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);const order=JSON.parse(result.stdout);
 assert.equal(order.executed,false);assert.equal(order.generationPlan.mode,'explicit');assert.equal(order.generationProvider,'json-worker');
 assert.equal(git(root,'status','--porcelain').trim(),'');
});
test('conflicting, invalid and irrelevant provider choices fail before native or provider execution',t=>{
 const root=fixture(t,twoModules);commit(root);
 for(const args of [['generate','--provider','unknown'],['generate','--provider','auto','--plugin','agentic-qe'],['setup','--provider','auto'],['repair','--provider','agentic-qe']]){
  const result=spawnSync(process.execPath,[cli,...args,'--root',root],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,2);assert.match(result.stderr,/provider/);
 }
 assert.equal(git(root,'status','--porcelain').trim(),'');
});
