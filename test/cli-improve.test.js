import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture,write,commit,git,twoModules} from './helpers.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
test('one-command local improvement adds ongoing quality policy only on a tested new branch',t=>{
 const root=fixture(t,twoModules);commit(root);const before=git(root,'rev-parse','HEAD').trim();
 write(root,'.tddswarm/proposal.json',{files:[{path:'test/boundary.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('additional independent value',()=>assert.equal(a,1));"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['Contract: a is one.']}},requirements:'Contract: a is one.'});
 const response=spawnSync(process.execPath,[cli,'improve','--local','--patch','.tddswarm/proposal.json','--action-ref','reviewed-sha','--json'],{cwd:root,encoding:'utf8',timeout:60000});
 assert.equal(response.status,0,response.stderr+'\n'+response.stdout);const result=JSON.parse(response.stdout);t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));
 assert.equal(result.status,'ready-for-review');assert.equal(result.fullRun.complete,true);assert.equal(result.fullRun.tests.length,3);assert.equal(git(root,'rev-parse','HEAD').trim(),before);assert.equal(git(root,'branch','--show-current').trim(),'main');assert.equal(git(root,'status','--porcelain').trim(),'');assert.equal(fs.existsSync(path.join(root,'tddswarm.config.json')),false);
 const workflow=fs.readFileSync(path.join(result.worktree,'.github/workflows/tddswarm.yml'),'utf8');assert.match(workflow,/'affected' \|\| 'full'/);assert.match(workflow,/branches: \["main"\]/);assert.match(workflow,/testlore@reviewed-sha/);assert.ok(result.repositoryPreparedPaths.includes('.github/workflows/tddswarm.yml'));assert.equal(result.merged,false);
});


test('nested project improvement installs an active repository workflow with project scope',t=>{
 const repo=fixture(t,Object.fromEntries(Object.entries(twoModules).map(([key,value])=>['packages/demo/'+key,value])));commit(repo);const root=path.join(repo,'packages/demo');
 write(root,'.tddswarm/proposal.json',{files:[{path:'test/extra.test.js',content:"import test from 'node:test';test('extra',()=>{});"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['Contract: a is one and b is two.']}},requirements:'Contract: a is one and b is two.'});
 const response=spawnSync(process.execPath,[cli,'improve','--local','--root',root,'--patch','.tddswarm/proposal.json','--json'],{cwd:repo,encoding:'utf8',timeout:60000});assert.equal(response.status,0,response.stderr+'\n'+response.stdout);const result=JSON.parse(response.stdout);t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));
 const workflow=result.repositoryPreparedPaths.find(file=>file.endsWith('.yml'));assert.ok(workflow.startsWith('.github/workflows/'));assert.equal(fs.existsSync(path.join(result.worktree,'.github/workflows')),false);const content=fs.readFileSync(path.join(result.worktreeRoot,workflow),'utf8');assert.match(content,/root: "packages\/demo"/);assert.match(content,/working-directory: "packages\/demo"/);assert.equal(result.fullRun.tests.length,3);assert.equal(git(repo,'branch','--show-current').trim(),'main');
});

test('first-run CLI creates a project agent and bootstraps written expectations on the isolated branch',t=>{
 const root=fixture(t,twoModules);
 write(root,'SPEC.md','Independent public contract: a is exactly one and b is exactly two. Preserve both contracts.');
 write(root,'.tddswarm/worker.cjs',`let text='';process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const p=JSON.parse(text);if(!p.requirements.includes('Independent public contract'))process.exit(9);const response=p.role==='architect'?{tasks:[{subject:'src/a.js',instructions:'Check the independently documented a contract'}]}:p.role==='author'?{files:[{path:'test/extra.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('documented a',()=>assert.equal(a,1));"}]}:{accepted:true,findings:[],oracle:{independent:true,basis:['SPEC.md states a is exactly one.']}};process.stdout.write(JSON.stringify(response));});`);
 write(root,'tddswarm.config.json',{runner:[process.execPath,'--test','{files}'],adapter:'node',discovery:'native',agent:[process.execPath,path.join(root,'.tddswarm/worker.cjs')]});commit(root);
 const response=spawnSync(process.execPath,[cli,'improve','--local','--json'],{cwd:root,encoding:'utf8',timeout:60000});assert.equal(response.status,0,response.stderr+'\n'+response.stdout);const result=JSON.parse(response.stdout);t.after(()=>fs.rmSync(result.worktreeRoot,{recursive:true,force:true}));
 assert.equal(result.status,'ready-for-review');assert.equal(result.fullRun.tests.length,3);assert.ok(result.preparedPaths.includes('tddswarm.requirements.md'));
 assert.equal(fs.existsSync(path.join(root,'tddswarm.requirements.md')),false);const original=JSON.parse(fs.readFileSync(path.join(root,'.tddswarm/agent.json'),'utf8'));const branch=JSON.parse(fs.readFileSync(path.join(result.worktree,'.tddswarm/agent.json'),'utf8'));assert.equal(original.name,branch.name);
 assert.equal(git(root,'branch','--show-current').trim(),'main');assert.equal(git(root,'status','--porcelain').trim(),'');
});
