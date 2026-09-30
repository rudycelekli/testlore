#!/usr/bin/env node
// Qualify the packed CLI through a production-only install in a fresh project.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url));
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'tddswarm-packed-proof-'));
const project=path.join(workspace,'project');const tools=path.join(workspace,'tools');
fs.mkdirSync(project);fs.mkdirSync(tools);
function invoke(cwd,argv,expected=0){const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',shell:false,timeout:120000,maxBuffer:16*1024*1024});assert.equal(r.status,expected,r.stderr+'\n'+r.stdout);return r.stdout;}
function write(file,content){const target=path.join(project,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof content==='string'?content:JSON.stringify(content));}
const outputIndex=process.argv.indexOf('--output');const output=path.resolve(outputIndex<0?path.join(source,'.tddswarm/packed-proof.json'):process.argv[outputIndex+1]);
let improvement;
try{
 const pack=JSON.parse(invoke(source,['npm','pack','--json','--pack-destination',workspace]))[0];
 const archive=path.join(workspace,pack.filename);const sha256=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 fs.writeFileSync(path.join(tools,'package.json'),JSON.stringify({name:'packed-proof',version:'1.0.0',private:true}));
 invoke(tools,['npm','install','--omit=dev','--ignore-scripts','--no-audit','--no-fund',archive]);
 const cli=path.join(tools,'node_modules/testlore/src/cli.js');
 const command=(args,exit=0)=>JSON.parse(invoke(project,[process.execPath,cli,...args,'--json'],exit));
 write('package.json',{type:'module'});write('.gitignore','.tddswarm/\n');
 for(const name of ['a','b']){write(`src/${name}.js`,`export const ${name}=1;`);write(`test/${name}.test.js`,`import test from 'node:test';import assert from 'node:assert/strict';import {${name}} from '../src/${name}.js';test('${name}',()=>assert.equal(${name},1));`);}
 for(const args of [['init','-b','main'],['config','user.name','Packed Proof'],['config','user.email','proof@example.invalid'],['add','.'],['commit','-m','baseline']])invoke(project,['git',...args]);
 command(['init']);invoke(project,['git','add','.']);invoke(project,['git','commit','-m','native configuration']);
 const initial=invoke(project,['git','rev-parse','HEAD']).trim();
 write('src/a.js','export const a=2;');
 const shadow=command(['run','--shadow','--base','HEAD'],1);
 assert.equal(shadow.complete,true);assert.deepEqual(shadow.plan.selected,['test/a.test.js']);assert.equal(shadow.tests.filter(t=>t.status==='failed').length,1);assert.equal(shadow.executedFiles.length,2);
 invoke(project,['git','restore','src/a.js']);
 const capture=command(['capture']);assert.equal(capture.complete,true);
 write('.tddswarm/proposal.json',{files:[{path:'test/extra.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('independent a contract',()=>assert.equal(a,1));"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['a and b are one.']}},requirements:'a and b are one.'});
 improvement=command(['improve','--local','--patch','.tddswarm/proposal.json','--action-ref','packed-proof']);
 assert.equal(improvement.status,'ready-for-review');assert.equal(improvement.fullRun.complete,true);assert.equal(improvement.fullRun.tests.filter(t=>t.status==='passed').length,3);
 assert.equal(invoke(project,['git','rev-parse','HEAD']).trim(),initial);assert.equal(invoke(project,['git','branch','--show-current']).trim(),'main');assert.equal(invoke(project,['git','status','--porcelain']).trim(),'');
 assert.match(fs.readFileSync(path.join(improvement.worktreeRoot,'.github/workflows/tddswarm.yml'),'utf8'),/testlore@packed-proof/);
 const receipt={schemaVersion:1,date:new Date().toISOString(),archive:pack.filename,sha256,version:pack.version,node:process.version,productionInstall:true,nativeShadow:{complete:shadow.complete,selected:shadow.plan.selected,executed:shadow.executedFiles.length,detected:true},runtimeCaptureComplete:capture.complete,improvement:{status:improvement.status,cases:improvement.fullRun.tests.length,originalBranch:'main'},limitations:['Local packed-artifact installation; no registry publication or live GitHub PR created.','Controlled two-module fixture; broad project compatibility remains unqualified.']};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}finally{
 if(improvement?.worktreeRoot)invoke(project,['git','worktree','remove','--force',improvement.worktreeRoot]);
 fs.rmSync(workspace,{recursive:true,force:true});
}
