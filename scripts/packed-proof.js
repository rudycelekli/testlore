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
const archiveIndex=process.argv.indexOf('--archive');
const expectedIndex=process.argv.indexOf('--expected-sha256');
const inputArchive=archiveIndex<0?null:path.resolve(process.argv[archiveIndex+1]||'');
const sourceIndex=process.argv.indexOf('--expected-source-sha'),expectedSource=sourceIndex<0?null:process.argv[sourceIndex+1];
if(expectedSource&&!/^[a-f0-9]{40}$/.test(expectedSource))throw new Error('Expected source SHA must be 40 lowercase hex characters');
const expectedSha=expectedIndex<0?null:process.argv[expectedIndex+1];
if(expectedSha&&!/^[a-f0-9]{64}$/.test(expectedSha))throw new Error('Expected SHA-256 must be 64 lowercase hex characters');
let improvement;
try{
 const pack=inputArchive?{filename:path.basename(inputArchive)}:JSON.parse(invoke(source,['npm','pack','--ignore-scripts','--json','--pack-destination',workspace]))[0];
 const archive=inputArchive||path.join(workspace,pack.filename);
 const archiveStat=fs.statSync(archive);assert.ok(archiveStat.isFile()&&archiveStat.size<=20*1024*1024,'Archive must be a regular file <=20 MB');
 const sha256=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 if(expectedSha)assert.equal(sha256,expectedSha,'Packed artifact checksum mismatch');
 fs.writeFileSync(path.join(tools,'package.json'),JSON.stringify({name:'packed-proof',version:'1.0.0',private:true}));
 invoke(tools,['npm','install','--omit=dev','--ignore-scripts','--no-audit','--no-fund',archive]);
 const installedPackage=JSON.parse(fs.readFileSync(path.join(tools,'node_modules/testlore/package.json'),'utf8'));assert.equal(installedPackage.name,'testlore');pack.version=installedPackage.version;
 const cli=path.join(tools,'node_modules/testlore/src/cli.js');
 const command=(args,exit=0)=>JSON.parse(invoke(project,[process.execPath,cli,...args,'--json'],exit));
 write('package.json',{type:'module'});write('.gitignore','.tddswarm/\n');
 for(const name of ['a','b']){write(`src/${name}.js`,`export const ${name}=1;`);write(`test/${name}.test.js`,`import test from 'node:test';import assert from 'node:assert/strict';import {${name}} from '../src/${name}.js';test('${name}',()=>assert.equal(${name},1));`);}
 for(const args of [['init','-b','main'],['config','user.name','Packed Proof'],['config','user.email','proof@example.invalid'],['add','.'],['commit','-m','baseline']])invoke(project,['git',...args]);
 command(['setup','--no-ci']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(project,'tddswarm.config.json'))).executionMode,'shadow');
 if(expectedSource){const {installedActionReference}=await import(path.join(tools,'node_modules/testlore/src/quality-layer.js'));assert.equal(installedPackage.gitHead,expectedSource);assert.equal(installedActionReference(),expectedSource);}
 const recommendation=command(['plugins','--recommend']);assert.ok(Array.isArray(recommendation.recommendations));
 const automatic=command(['plugins','--auto']);assert.equal(automatic.changed,false);
 const catalog=command(['plugins']);assert.ok(catalog.plugins.some(plugin=>plugin.id==='ruvector'&&!plugin.enabled));
 command(['plugins','--enable','ruvector']);
 const missingVectorSdk=command(['plugins','--check','--plugin','ruvector'],2);
 assert.equal(missingVectorSdk.plugins[0].available,false);
 invoke(project,['git','add','.']);invoke(project,['git','commit','-m','native configuration']);
 const initial=invoke(project,['git','rev-parse','HEAD']).trim();
 write('src/a.js','export const a=2;');
 const shadow=command(['run','--base','HEAD'],1);
 assert.equal(shadow.shadow,true);assert.equal(shadow.complete,true);assert.deepEqual(shadow.plan.selected,['test/a.test.js']);assert.equal(shadow.tests.filter(t=>t.status==='failed').length,1);assert.equal(shadow.executedFiles.length,2);
 invoke(project,['git','restore','src/a.js']);
 const capture=command(['capture']);assert.equal(capture.complete,true);
 write('.tddswarm/proposal.json',{files:[{path:'test/extra.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('independent a contract',()=>assert.equal(a,1));"}],review:{accepted:true,findings:[],oracle:{independent:true,basis:['a and b are one.']}},requirements:'a and b are one.'});
 improvement=command(['improve','--local','--patch','.tddswarm/proposal.json']);
 assert.equal(improvement.status,'ready-for-review');assert.equal(improvement.fullRun.complete,true);assert.equal(improvement.fullRun.tests.filter(t=>t.status==='passed').length,3);
 assert.equal(invoke(project,['git','rev-parse','HEAD']).trim(),initial);assert.equal(invoke(project,['git','branch','--show-current']).trim(),'main');assert.equal(invoke(project,['git','status','--porcelain']).trim(),'');
 const workflowActionReference=expectedSource||installedPackage.gitHead||'main';
 const workflowReferences=[...fs.readFileSync(path.join(improvement.worktreeRoot,'.github/workflows/tddswarm.yml'),'utf8').matchAll(/^[ \t]*(?:-[ \t]*)?uses:[ \t]*rudycelekli\/testlore@([^\s]+)[ \t]*$/gm)].map(match=>match[1]);
 assert.ok(workflowReferences.length>0);assert.ok(workflowReferences.every(reference=>reference===workflowActionReference),'Generated workflow must use the exact archive source identity');
 const recall=command(['recall','--query','independent a contract']);assert.ok(recall.records.length);assert.equal(recall.advisoryOnly,true);assert.equal(recall.retrieval,'deterministic-lexical');
 assert.ok(recall.warnings.some(value=>value==='RuVector fallback: ruvector-sdk-missing'));
 assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),sha256,'Archive changed during qualification');
 const receipt={schemaVersion:1,exactInputArchive:Boolean(inputArchive),proofScriptSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),date:new Date().toISOString(),archive:pack.filename,sha256,version:pack.version,node:process.version,productionInstall:true,packedManifestSha256:createHash('sha256').update(fs.readFileSync(path.join(tools,'node_modules/testlore/package.json'))).digest('hex'),actionReference:installedPackage.gitHead||null,workflowActionReference,actionIdentityVerified:Boolean(expectedSource),shadowSetupVerified:true,plugins:{catalogCount:catalog.plugins.length,missingSdkExit:missingVectorSdk.exitCode,lexicalFallbackVerified:true},nativeShadow:{complete:shadow.complete,selected:shadow.plan.selected,executed:shadow.executedFiles.length,detected:true},runtimeCaptureComplete:capture.complete,improvement:{status:improvement.status,cases:improvement.fullRun.tests.length,originalBranch:'main'},limitations:['Local packed-artifact installation; no registry publication or live GitHub PR created.','Controlled two-module fixture; broad project compatibility remains unqualified.']};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}finally{
 if(improvement?.worktreeRoot)invoke(project,['git','worktree','remove','--force',improvement.worktreeRoot]);
 fs.rmSync(workspace,{recursive:true,force:true});
}
