import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {improve} from '../src/improvement.js';
import {publishImprovement,verifyPullRequestMetadata} from '../src/pull-request.js';
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
 const result={status:'ready-for-review',validation:{accepted:true},fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:git(root,'rev-parse','HEAD').trim(),branch:'tddswarm/improve-safe',baseBranch:'main',worktree:root,execution:{tests:[{status:'passed'}]}};
 result.sourceHead=git(root,'rev-parse','main').trim();
 const cli=fakeGithub(root,result);
 const published=publishImprovement(root,result,{command:[process.execPath,cli]});assert.equal(published.pullRequest,'https://github.com/test-owner/project/pull/123');assert.equal(git(bare,'rev-parse','refs/heads/tddswarm/improve-safe').trim(),result.sha);
 assert.equal(published.published,true);assert.equal(published.pullRequestVerification.headRefOid,result.sha);
 assert.ok(fs.readFileSync(path.join(root,'.tddswarm/pull-request.md'),'utf8').startsWith(`<!-- testlore-source-head:${result.sourceHead} -->`));
 const requests=fs.readFileSync(path.join(root,'.tddswarm/requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(requests[1].slice(0,8),['pr','create','--repo','test-owner/project','--head',result.branch,'--base','main']);
 assert.deepEqual(requests[2],['pr','view',published.pullRequest,'--repo','test-owner/project','--json','url,headRefOid,headRefName,baseRefName,state,isDraft']);
});


test('verified shared dependency metadata does not block an otherwise clean improvement publication',async t=>{
 const root=fixture(t,twoModules);commit(root);write(root,'node_modules/proof.marker','installed dependency');
 const result=await improve(root,{patch:{files:[{path:'test/extra.test.js',content:"import test from 'node:test';test('extra',()=>{});"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['a is one and b is two']}},requirements:'a is one and b is two'}});t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));assert.equal(result.status,'ready-for-review');assert.ok(git(result.worktree,'status','--porcelain').includes('node_modules'));
 const bare=fixture(t);git(bare,'init','--bare');git(root,'remote','add','origin','https://github.com/test-owner/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/test-owner/project.git');git(root,'push','origin','main');
 const cli=fakeGithub(result.worktree,result,{number:124});
 assert.equal(publishImprovement(root,result,{command:[process.execPath,cli]}).pullRequest,'https://github.com/test-owner/project/pull/124');
});

function publicationFixture(t) {
 const root=fixture(t,twoModules);commit(root);const bare=fixture(t);git(bare,'init','--bare');
 git(root,'remote','add','origin','https://github.com/test-owner/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/test-owner/project.git');git(root,'checkout','-b','tddswarm/improve-bound');
 const result={status:'ready-for-review',validation:{accepted:true},fullRun:{complete:true,exitCode:0,tests:[{status:'passed'}]},sha:git(root,'rev-parse','HEAD').trim(),sourceHead:git(root,'rev-parse','main').trim(),branch:'tddswarm/improve-bound',baseBranch:'main',worktree:root};
 return {root,bare,result};
}
// These CLI fixtures exercise the publication contract; they are not live GitHub proof.
function fakeGithub(root,result,{number=123,metadata={},invalidJson=false,onView=''}={}){
 const url=`https://github.com/test-owner/project/pull/${number}`;
 const verified={url,headRefOid:result.sha,headRefName:result.branch,baseRefName:result.baseBranch,state:'OPEN',isDraft:false,...metadata};
 const script=`const fs=require('fs'),cp=require('child_process');const a=process.argv.slice(2);fs.appendFileSync('.tddswarm/requests.jsonl',JSON.stringify(a)+'\\n');if(a[0]==='repo')console.log(JSON.stringify({nameWithOwner:'test-owner/project'}));else if(a[1]==='view'){${onView};console.log(${JSON.stringify(invalidJson?'not JSON':JSON.stringify(verified))});}else if(a[1]==='create'){const i=a.indexOf('--body-file');if(i<0||!fs.readFileSync(a[i+1],'utf8').includes('full discovered suite'))process.exit(8);console.log(${JSON.stringify(url)});}else process.exit(9);`;
 write(root,'.tddswarm/github.cjs',script);return path.join(root,'.tddswarm','github.cjs');
}

test('PR metadata must bind the exact repository, tested SHA, refs and open state',()=>{
 const expected={repository:'test-owner/project',sha:'a'.repeat(40),branch:'tddswarm/improve-bound',base:'main'},valid={url:'https://github.com/test-owner/project/pull/123',headRefOid:expected.sha,headRefName:expected.branch,baseRefName:expected.base,state:'OPEN',isDraft:false};
 assert.equal(verifyPullRequestMetadata(valid,expected).headRefOid,expected.sha);
 for(const change of [{url:'https://github.com/other-owner/project/pull/123'},{url:'https://github.com/test-owner/project/pull/123?x=1'},{url:'https://github.com/test-owner/project/pull/0'},{headRefOid:'b'.repeat(40)},{headRefName:'untested-head'},{baseRefName:'different-base'},{state:'MERGED'},{state:'CLOSED'},{isDraft:undefined}])assert.throws(()=>verifyPullRequestMetadata({...valid,...change},expected));
 for(const missing of [null,[],{},'https://github.com/test-owner/project/pull/123'])assert.throws(()=>verifyPullRequestMetadata(missing,expected));
});

test('a created URL alone or mismatched returned head never produces published true',t=>{
 const {root,result}=publicationFixture(t);
 const invalid=fakeGithub(root,result,{invalidJson:true});assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,invalid]}),/metadata could not be verified/);
 const wrongHead=fakeGithub(root,result,{metadata:{headRefOid:'a'.repeat(40)}});assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,wrongHead]}),/metadata differs/);
 assert.equal(result.published,undefined);
});

test('explicit existing PR reuses only verified open metadata and never calls create',t=>{
 const {root,result}=publicationFixture(t),cli=fakeGithub(root,result,{number:321,metadata:{isDraft:true}});
 const published=publishImprovement(root,result,{command:[process.execPath,cli],pullRequest:'https://github.com/test-owner/project/pull/321'});
 assert.equal(published.published,true);assert.equal(published.pullRequestVerification.isDraft,true);
 const requests=fs.readFileSync(path.join(root,'.tddswarm/requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(requests.some(a=>a[1]==='create'),false);
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,cli],pullRequest:'https://github.com/other-owner/project/pull/321'}),/Existing pull request URL/);
});

test('repair PR title and rationale describe source changes with unchanged assertions',t=>{
 const {root,result}=publicationFixture(t);git(root,'branch','-m','tddswarm/repair-bound');Object.assign(result,{kind:'source-repair',branch:'tddswarm/repair-bound',files:['src/a.js'],validation:{accepted:true,baselineRuns:[{},{}],candidateRuns:[{},{}]}});
 const published=publishImprovement(root,result,{command:[process.execPath,fakeGithub(root,result)]});assert.equal(published.published,true);
 const body=fs.readFileSync(path.join(root,'.tddswarm/pull-request.md'),'utf8');assert.match(body,/original assertions were retained unchanged/);assert.match(body,/Source changes: src\/a.js/);assert.match(body,/Baseline runs: 2; candidate runs: 2/);
 assert.ok(body.startsWith(`<!-- testlore-source-head:${result.sourceHead} -->`));
 const requests=fs.readFileSync(path.join(root,'.tddswarm/requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse),created=requests.find(a=>a[1]==='create');assert.equal(created[created.indexOf('--title')+1],'Repair the verified source failure with TestLore');
});

test('metadata lookup cannot silently mutate the locally tested commit',t=>{
 const {root,result}=publicationFixture(t);
 const cli=fakeGithub(root,result,{onView:"fs.writeFileSync('src/a.js','export const a=999;');cp.execFileSync('git',['add','src/a.js']);cp.execFileSync('git',['commit','-m','Untested during metadata lookup']);"});
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,cli]}),/branch changed/);
});

test('returned PR metadata cannot conceal a remote head moved during lookup',t=>{
 const {root,bare,result}=publicationFixture(t);
 const alternate=git(root,'commit-tree',git(root,'rev-parse','HEAD^{tree}').trim(),'-p',result.sha,'-m','Untested remote commit').trim();
 git(root,'push','origin',`${alternate}:refs/heads/unrelated`);
 const onView=`cp.execFileSync('git',['--git-dir',${JSON.stringify(bare)},'update-ref',${JSON.stringify('refs/heads/'+result.branch)},${JSON.stringify(alternate)}]);`;
 const cli=fakeGithub(root,result,{onView});
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,cli]}),/Published remote branch differs/);
 assert.equal(git(root,'rev-parse','HEAD').trim(),result.sha);
});
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
