import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,commit,git,twoModules} from './helpers.js';
import {stagePatch,validateCandidates} from '../src/candidates.js';
import {recallLessons,exportLearning} from '../src/learning.js';
import {generate} from '../src/swarm.js';
import {improve} from '../src/improvement.js';
const proposal={files:[{path:'test/learned.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('learned boundary invariant',()=>assert.equal(a,1));"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['Independent a contract is one.']}},requirements:'Independent a contract is one. Include boundary assertions.'};
test('validation automatically retains patterns and generation retrieves them without teaching the reviewer',async t=>{
 const root=fixture(t,twoModules);
 write(root,'.tddswarm/worker.cjs',`const fs=require('node:fs');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const p=JSON.parse(input);fs.appendFileSync('.tddswarm/worker-payloads.jsonl',JSON.stringify(p)+'\\n');const result=p.role==='architect'?{tasks:[{subject:'src/a.js',instructions:'Check the independent boundary invariant'}]}:p.role==='author'?${JSON.stringify({files:proposal.files})}:${JSON.stringify(proposal.review)};process.stdout.write(JSON.stringify(result));});`);
 write(root,'tddswarm.config.json',{adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}'],agent:[process.execPath,path.join(root,'.tddswarm/worker.cjs')]});write(root,'tddswarm.requirements.md',proposal.requirements);
 const staged=stagePatch(root,proposal);assert.equal(validateCandidates(root,staged.id).accepted,true);
 assert.equal(recallLessons(root,'boundary invariant').records.length,1);
 const generated=await generate(root,{execute:true});assert.equal(generated.review.accepted,true);
 const calls=fs.readFileSync(path.join(root,'.tddswarm/worker-payloads.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const call of calls.filter(c=>c.role!=='reviewer')){assert.equal(call.learning.advisoryOnly,true);assert.equal(call.learning.records.length,1);assert.match(JSON.stringify(call.learning),/learned boundary invariant/);}
 assert.equal(calls.find(c=>c.role==='reviewer').learning,undefined);
 assert.doesNotMatch(JSON.stringify(exportLearning(root)),/learned boundary invariant|src\/a|Independent a contract/);
});
test('branch improvements carry local learning back while preserving the original checkout',async t=>{
 const root=fixture(t,twoModules);commit(root);const head=git(root,'rev-parse','HEAD').trim();
 const result=await improve(root,{patch:proposal});t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));
 assert.equal(result.status,'ready-for-review');assert.equal(result.learning.transferred,true);
 const recalled=recallLessons(root,'boundary invariant');assert.equal(recalled.records.length,1);assert.equal(recalled.records[0].historical,true);
 assert.equal(git(root,'rev-parse','HEAD').trim(),head);assert.equal(git(root,'branch','--show-current').trim(),'main');assert.equal(git(root,'status','--porcelain').trim(),'');
});
