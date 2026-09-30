import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {improve} from '../src/improvement.js';
import {publishImprovement} from '../src/pull-request.js';
import {fixture,write,commit,git,twoModules} from './helpers.js';
test('publication requires the exact clean tested branch commit',t=>{
 const root=fixture(t,twoModules);commit(root);
 assert.throws(()=>publishImprovement(root,{status:'rejected'}),/Only a tested/);
 const result={status:'ready-for-review',validation:{accepted:true},fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:'wrong',branch:'main',baseBranch:'main',worktree:root};
 result.branch='tddswarm/improve-test';git(root,'branch',result.branch);assert.throws(()=>publishImprovement(root,result),/branch changed/);
 result.sha=git(root,'rev-parse','HEAD').trim();write(root,'src/a.js','changed');
 assert.throws(()=>publishImprovement(root,result),/worktree changed/);
});
test('automatic PR publication uses actual Git push and structured GitHub CLI arguments',t=>{
 const root=fixture(t,twoModules);commit(root);const bare=fixture(t);git(bare,'init','--bare');
 git(root,'remote','add','origin','https://github.com/test-owner/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/test-owner/project.git');git(root,'push','origin','main');git(root,'checkout','-b','tddswarm/improve-safe');
 write(root,'test/extra.test.js',"import test from 'node:test';test('extra',()=>{});");git(root,'add','.');git(root,'commit','-m','Reviewed tests');
 const cli=path.join(root,'.tddswarm','github.cjs');write(root,'.tddswarm/github.cjs',"const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync('.tddswarm/requests.jsonl',JSON.stringify(a)+'\\n');if(a[0]==='repo')console.log(JSON.stringify({nameWithOwner:'test-owner/project'}));else {const i=a.indexOf('--body-file');if(i<0||!fs.readFileSync(a[i+1],'utf8').includes('full discovered suite'))process.exit(8);console.log('https://github.com/test-owner/project/pull/123');}");
 const result={status:'ready-for-review',validation:{accepted:true},fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:git(root,'rev-parse','HEAD').trim(),branch:'tddswarm/improve-safe',baseBranch:'main',worktree:root,execution:{tests:[{status:'passed'}]}};
 const published=publishImprovement(root,result,{command:[process.execPath,cli]});assert.equal(published.pullRequest,'https://github.com/test-owner/project/pull/123');assert.equal(git(bare,'rev-parse','refs/heads/tddswarm/improve-safe').trim(),result.sha);
 const args=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/requests.jsonl'),'utf8').trim().split('\n')[1]);assert.deepEqual(args.slice(0,8),['pr','create','--repo','test-owner/project','--head',result.branch,'--base','main']);
});


test('verified shared dependency metadata does not block an otherwise clean improvement publication',async t=>{
 const root=fixture(t,twoModules);commit(root);write(root,'node_modules/proof.marker','installed dependency');
 const result=await improve(root,{patch:{files:[{path:'test/extra.test.js',content:"import test from 'node:test';test('extra',()=>{});"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['a is one and b is two']}},requirements:'a is one and b is two'}});t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));assert.equal(result.status,'ready-for-review');assert.ok(git(result.worktree,'status','--porcelain').includes('node_modules'));
 const bare=fixture(t);git(bare,'init','--bare');git(root,'remote','add','origin','https://github.com/test-owner/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/test-owner/project.git');git(root,'push','origin','main');
 const cli=path.join(result.worktree,'.tddswarm','gh.cjs');write(result.worktree,'.tddswarm/gh.cjs',"console.log(process.argv[2]==='repo'?'{}':'https://github.com/test-owner/project/pull/124');");
 assert.equal(publishImprovement(root,result,{command:[process.execPath,cli]}).pullRequest,'https://github.com/test-owner/project/pull/124');
});

function publicationFixture(t) {
 const root=fixture(t,twoModules);commit(root);const bare=fixture(t);git(bare,'init','--bare');
 git(root,'remote','add','origin','https://github.com/test-owner/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/test-owner/project.git');git(root,'checkout','-b','tddswarm/improve-bound');
 const result={status:'ready-for-review',validation:{accepted:true},fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:git(root,'rev-parse','HEAD').trim(),branch:'tddswarm/improve-bound',baseBranch:'main',worktree:root};
 return {root,bare,result};
}
test('authentication cannot publish a branch changed after the tested-state check',t=>{
 const {root,bare,result}=publicationFixture(t);
 const cli=path.join(root,'.tddswarm','gh.cjs');write(root,'.tddswarm/gh.cjs',`const fs=require('fs'),cp=require('child_process');if(process.argv[2]==='repo'){fs.writeFileSync('src/a.js','export const a=999;');cp.execFileSync('git',['add','src/a.js']);cp.execFileSync('git',['commit','-m','Untested concurrent change']);console.log('{}')}else console.log('https://github.com/test-owner/project/pull/125');`);
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,cli]}),/branch changed/);
 assert.throws(()=>git(bare,'rev-parse',`refs/heads/${result.branch}`));
});
test('a pre-push hook moving the local branch cannot substitute its untested commit',t=>{
 const {root,bare,result}=publicationFixture(t);
 const cli=path.join(root,'.tddswarm','gh.cjs');write(root,'.tddswarm/gh.cjs',"console.log(process.argv[2]==='repo'?'{}':'https://github.com/test-owner/project/pull/126');");
 const hook=path.join(root,'.git','hooks','pre-push');fs.writeFileSync(hook,"#!/bin/sh\nprintf 'export const a=999;\\n' > src/a.js\ngit add src/a.js\ngit commit -m 'Untested hook change' >/dev/null\n");fs.chmodSync(hook,0o755);
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,cli]}),/branch changed/);
 assert.equal(git(bare,'rev-parse',`refs/heads/${result.branch}`).trim(),result.sha);
 assert.notEqual(git(root,'rev-parse','HEAD').trim(),result.sha);
 assert.equal(git(bare,'show',`${result.branch}:src/a.js`).trim(),twoModules['src/a.js'].trim());
});
