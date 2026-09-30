import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { improve } from '../src/improvement.js';
import { stagePatch, validateCandidates } from '../src/candidates.js';
import { fixture, commit, git, write, twoModules } from './helpers.js';
const testSource = `import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('a boundary',()=>assert.equal(a+1,2));`;
const review = { accepted:true,findings:[],oracle:{independent:true,basis:['Requirement: module a exports one and its successor is two.']} };
const patch = content => ({files:[{path:'test/boundary.test.js',content:content||testSource}],requirements:'a exports one.',review});
function project(t,extras={}){const root=fixture(t,{...twoModules,...extras});commit(root);return root;}
function cleanup(t,root,result){t.after(()=>{try{git(root,'worktree','remove','--force',result.worktreeRoot);}catch{};try{git(root,'branch','-D',result.branch);}catch{};fs.rmSync(result.worktreeRoot,{recursive:true,force:true});});}

test('improvement full-tests a new branch and commits without changing the original checkout',async t=>{
  const root=project(t);const original=git(root,'rev-parse','HEAD');
  const result=await improve(root,{patch:patch()});cleanup(t,root,result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.ok(result.sha);assert.equal(result.baseBranch,'main');assert.equal(result.sourceHead,original.trim());
  assert.notEqual(result.sha,result.base);assert.equal(result.fullRun.complete,true);assert.equal(result.fullRun.tests.length,3);
  assert.equal(result.validation.original.tests.length,2);assert.equal(result.validation.candidate.tests.length,3);
  assert.equal(git(root,'rev-parse','HEAD'),original);assert.equal(git(root,'branch','--show-current').trim(),'main');assert.equal(git(root,'status','--porcelain').trim(),'');
  assert.equal(fs.existsSync(path.join(root,'test/boundary.test.js')),false);assert.equal(fs.existsSync(path.join(result.worktree,'test/boundary.test.js')),true);
  assert.equal(result.merged,false);assert.ok(fs.existsSync(result.receipt));
});

test('defective candidate is rejected, has no commit, and retains branch evidence',async t=>{
  const root=project(t);const result=await improve(root,{patch:patch(testSource.replace('a+1,2','a+1,99'))});cleanup(t,root,result);
  assert.equal(result.status,'validation-rejected');assert.equal(result.sha,null);assert.equal(git(root,'rev-parse',result.branch).trim(),result.base);
  assert.equal(result.validation.candidate.exitCode,1);assert.ok(fs.existsSync(result.receipt));assert.equal(fs.existsSync(path.join(root,'test/boundary.test.js')),false);
});

test('dirty tracked and relevant untracked files refuse before branch creation',async t=>{
  const root=project(t);write(root,'src/a.js','export const a=2;');
  await assert.rejects(improve(root,{patch:patch()}),/Commit or stash/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a=2;');
  git(root,'restore','src/a.js');write(root,'new-subject.js','export const next=1;');
  await assert.rejects(improve(root,{patch:patch()}),/new-subject/);
  assert.equal(git(root,'branch','--list','tddswarm/improve-*').trim(),'');
});

test('prevalidated candidate id is copied and validated again in the branch',async t=>{
  const root=project(t);const candidate=stagePatch(root,patch());assert.equal(validateCandidates(root,candidate.id).accepted,true);
  const result=await improve(root,{id:candidate.id});cleanup(t,root,result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.candidate.id,candidate.id);
  assert.notEqual(result.candidate.directory,candidate.directory);assert.equal(fs.existsSync(path.join(root,'test/boundary.test.js')),false);
});

test('candidate ids, branch names and supplied checkout paths cannot inject paths or Git options',async t=>{
  const root=project(t);
  await assert.rejects(improve(root,{id:'../bad'}),/candidate id/);
  await assert.rejects(improve(root,{branch:'--detach',patch:patch()}),/branch/);
  await assert.rejects(improve(root,{branch:'tddswarm/improve-../../escape',patch:patch()}),/branch/);
  await assert.rejects(improve(root,{worktree:'/tmp/arbitrary',patch:patch()}),/generated/);
});

test('quality preparation files are committed only after the final full run passes',async t=>{
  const root=project(t);const result=await improve(root,{patch:patch(),prepare:branch=>{write(branch,'quality-notes.md','Keep shadow evidence after merge.');return ['quality-notes.md'];}});cleanup(t,root,result);
  assert.equal(result.status,'ready-for-review');assert.equal(fs.existsSync(path.join(root,'quality-notes.md')),false);
  assert.match(git(result.worktreeRoot,'show',`${result.sha}:quality-notes.md`),/shadow/);assert.deepEqual(result.preparedPaths,['quality-notes.md']);
});

test('preparation that breaks tests prevents a commit and retains the changed branch',async t=>{
  const root=project(t);const result=await improve(root,{patch:patch(),prepare:branch=>{write(branch,'src/a.js','export const a=99;');return ['src/a.js'];}});cleanup(t,root,result);
  assert.equal(result.status,'full-run-failed');assert.equal(result.sha,null);assert.equal(result.fullRun.exitCode,1);assert.equal(git(root,'rev-parse',result.branch).trim(),result.base);
  assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),twoModules['src/a.js']);
});

test('preparation cannot replace the exact reviewed candidate',async t=>{
  const root=project(t);const result=await improve(root,{patch:patch(),prepare:branch=>{write(branch,'test/boundary.test.js',testSource.replace('assert.equal(a+1,2)','assert.ok(true)'));return ['test/boundary.test.js'];}});cleanup(t,root,result);
  assert.equal(result.status,'failed');assert.match(result.error,/altered reviewed/);assert.equal(result.sha,null);
});

test('no configured worker returns a reviewable branch and work order without a success claim',async t=>{
  const root=project(t);const result=await improve(root);cleanup(t,root,result);
  assert.equal(result.status,'awaiting-agent');assert.equal(result.sha,null);assert.equal(result.workOrder.executed,false);assert.equal(fs.existsSync(result.receipt),true);
});

test('initialization runs only for generation and before the worker requirement check',async t=>{
  const root=project(t);let initialized=false;
  const result=await improve(root,{initialize:branch=>{initialized=true;write(branch,'tddswarm.config.json',{runner:['node','--test','{files}']});return ['tddswarm.config.json'];}});cleanup(t,root,result);
  assert.equal(initialized,true);assert.equal(result.status,'awaiting-agent');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
});

test('changes in the original checkout during improvement are preserved and prevent a commit',async t=>{
  const root=project(t);const result=await improve(root,{patch:patch(),prepare:()=>{write(root,'src/a.js','export const a=42;');return [];}});cleanup(t,root,result);
  assert.equal(result.status,'failed');assert.match(result.error,/Original checkout changed/);assert.equal(result.sha,null);
  assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a=42;');
});

test('a test-free project can bootstrap reviewed tests on its improvement branch',async t=>{
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\n','src/a.js':'export const a=1;'});commit(root);
  const result=await improve(root,{patch:patch()});cleanup(t,root,result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.validation.original.tests.length,0);assert.equal(result.fullRun.tests.length,1);
});

test('subdirectory projects commit paths relative to the repository worktree',async t=>{
  const repository=fixture(t,Object.fromEntries(Object.entries(twoModules).map(([name,content])=>[`packages/demo/${name}`,content])));commit(repository);
  const root=path.join(repository,'packages/demo');const result=await improve(root,{patch:patch()});cleanup(t,repository,result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.worktree,path.join(result.worktreeRoot,'packages/demo'));
  assert.match(git(result.worktreeRoot,'show','--format=','--name-only',result.sha),/packages\/demo\/test\/boundary.test.js/);
  assert.equal(fs.existsSync(path.join(root,'test/boundary.test.js')),false);
});

test('Git hooks cannot omit a tested candidate and still claim a verified commit',async t=>{
  const root=project(t);const hook=path.join(root,'.git/hooks/pre-commit');fs.writeFileSync(hook,'#!/bin/sh\ngit rm --cached -- test/boundary.test.js\n');fs.chmodSync(hook,0o755);
  const result=await improve(root,{patch:patch(),prepare:branch=>{write(branch,'quality-notes.md','Continuous shadow evidence.');return ['quality-notes.md'];}});cleanup(t,root,result);
  assert.equal(result.status,'commit-requires-review');assert.ok(result.sha);assert.match(result.error,/Committed tree differs/);
  assert.equal(fs.existsSync(path.join(root,'test/boundary.test.js')),false);
});


test('a commit hook staging sibling-project changes invalidates the exact tested tree',async t=>{
 const repo=fixture(t,Object.fromEntries(Object.entries(twoModules).map(([key,value])=>['packages/demo/'+key,value])));
 write(repo,'other-project/config.js','export const version=1;');commit(repo);
 const hook=path.join(repo,'.git/hooks/pre-commit');fs.writeFileSync(hook,'#!/bin/sh\nprintf "export const version=99;" > other-project/config.js\ngit add -- other-project/config.js\n');fs.chmodSync(hook,0o755);
 const result=await improve(path.join(repo,'packages/demo'),{patch:{files:[{path:'test/extra.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';test('extra',()=>assert.equal(1,1));"}],review,requirements:'Contract: a is one and b is two.'}});
 t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));
 assert.equal(result.status,'commit-requires-review',JSON.stringify(result));assert.match(result.error,/repository tree/);assert.ok(git(result.worktreeRoot,'diff','--name-only',result.base,result.sha).includes('other-project/config.js'));
});
