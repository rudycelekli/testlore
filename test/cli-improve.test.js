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
 const workflow=fs.readFileSync(path.join(result.worktree,'.github/workflows/tddswarm.yml'),'utf8');assert.match(workflow,/'affected' \|\| 'full'/);assert.match(workflow,/branches: \[main\]/);assert.match(workflow,/tddswarm@reviewed-sha/);assert.ok(result.preparedPaths.includes('.github/workflows/tddswarm.yml'));assert.equal(result.merged,false);
});
