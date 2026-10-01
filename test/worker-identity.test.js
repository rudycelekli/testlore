import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileIdentity, resolveWorkerExecutable, captureWorkerIdentity, assertWorkerIdentity } from '../scripts/worker-identity.js';
import { defaultDataset, evaluateLearning } from '../scripts/learning-evaluation.js';

function temporary(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-worker-identity-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root; }
test('worker resolution follows child cwd, relative PATH entries and executable permissions',t=>{
  const root=temporary(t), trial=path.join(root,'trial'), bin=path.join(trial,'bin');fs.mkdirSync(bin,{recursive:true});
  const launcher=path.join(bin,'worker');fs.writeFileSync(launcher,'#!/usr/bin/env node\n');fs.chmodSync(launcher,0o755);
  assert.equal(resolveWorkerExecutable('./bin/worker',trial),launcher);
  assert.equal(resolveWorkerExecutable('worker',trial,{PATH:'bin'}),launcher);
  fs.chmodSync(launcher,0o644);assert.throws(()=>resolveWorkerExecutable('worker',trial,{PATH:'bin'}),/cannot be resolved/);
  assert.throws(()=>resolveWorkerExecutable('worker',trial,{}),/PATH is absent/);
});
test('bounded identity binds realpath, script operands and inline source without inferring a provider model',t=>{
  const root=temporary(t),script=path.join(root,'worker.cjs');fs.writeFileSync(script,'process.exit(0);');
  const node=fileIdentity(process.execPath,512*1024*1024);
  const captured=captureWorkerIdentity([process.execPath,'./worker.cjs','--model','declared-only'],{cwd:root,declaration:'operator/provider/model',controllerNode:node});
  assert.equal(captured.files[0].path,script);assert.equal(captured.node.sha256,node.sha256);assert.equal(captured.model.requested,'declared-only');assert.equal(captured.model.verified,null);assert.equal(captured.verificationScope.fullRuntimeAttestation,false);
  assert.deepEqual(assertWorkerIdentity(captured,{controllerNode:node}),captured);
  const inline=captureWorkerIdentity([process.execPath,'-e',"process.stdout.write('{}');"],{cwd:root,controllerNode:node});
  assert.equal(inline.inline.length,1);assert.deepEqual(inline.files,[]);assert.equal(inline.model.requested,null);assert.equal(inline.model.verified,null);
  fs.appendFileSync(script,' // drift');assert.throws(()=>assertWorkerIdentity(captured,{controllerNode:node}),/Worker identity drift/);
  const oversized=path.join(root,'large');fs.writeFileSync(oversized,'12345');assert.throws(()=>fileIdentity(oversized,4),/bounded regular file/);
  assert.throws(()=>fileIdentity(root),/bounded regular file/);assert.throws(()=>fileIdentity(script,0),/byte budget/);
  const credential=path.join(root,'auth.json'),alias=path.join(root,'alias.json');fs.writeFileSync(credential,'fixture');fs.symlinkSync(credential,alias);
  assert.throws(()=>captureWorkerIdentity([process.execPath,script,'--config',alias],{cwd:root,controllerNode:node}),/Credential-like/);
  assert.throws(()=>captureWorkerIdentity([process.execPath,'./worker.cjs'],{cwd:path.join(root,'other'),controllerNode:node}),/ENOENT/);
});
test('a replaced launcher symlink is drift even when replacement content matches',t=>{
  const root=temporary(t),first=path.join(root,'first'),second=path.join(root,'second'),link=path.join(root,'launcher');
  for(const file of [first,second]){fs.writeFileSync(file,'#!/usr/bin/env node\nprocess.exit(0);');fs.chmodSync(file,0o755);}
  fs.symlinkSync(first,link);const expected=captureWorkerIdentity([link],{cwd:root});fs.unlinkSync(link);fs.symlinkSync(second,link);
  assert.throws(()=>assertWorkerIdentity(expected),/Worker identity drift/);
});
test('script and launcher drift reject role output, keep attempts/response receipts and leave model verification unknown',async t=>{
  const root=temporary(t),dataset=defaultDataset();dataset.fixtures=dataset.fixtures.slice(0,2);dataset.fixtures.forEach(f=>{f.defects=f.defects.slice(0,1);});
  for(const kind of ['script','launcher']){
    const worker=path.join(root,kind==='script'?'worker.cjs':'launcher');
    const source="const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const p=JSON.parse(input);fs.appendFileSync(__filename,'\\n// identity drift');process.stdout.write(JSON.stringify({tasks:[{subject:p.context[0].file,instructions:p.requirements}],model:'invented-verified-model'}));});";
    fs.writeFileSync(worker,(kind==='launcher'?`#!${process.execPath}\n`:'')+source);if(kind==='launcher')fs.chmodSync(worker,0o755);
    const output=path.join(root,kind+'-receipts'),agent=kind==='script'?[process.execPath,worker]:[worker];
    const summary=await evaluateLearning({output,agent,identity:'operator/model-declaration',dataset,repeat:1,maxCalls:12,evidenceKind:'protocol-fixture'});
    assert.equal(summary.calls,4);assert.equal(summary.attemptedCalls,4);assert.equal(summary.spawnedCalls,1);assert.equal(summary.arms.reduce((count,arm)=>count+arm.spawnedCalls,0),1);assert.equal(summary.comparison.complete,false);assert.ok(summary.arms.every(arm=>arm.failedTrials===2&&arm.detected===0));assert.equal(summary.workerIdentity.model.verified,null);assert.equal(summary.workerIdentity.model.requested,null);
    const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));assert.ok(manifest.implementationHashes['src/adapters/codex.js']);assert.ok(manifest.implementationHashes['scripts/worker-identity.js']);assert.equal(manifest.workerIdentity.verificationScope.fullRuntimeAttestation,false);
    const trials=fs.readdirSync(output).filter(file=>file.startsWith('trial-')).map(file=>JSON.parse(fs.readFileSync(path.join(output,file)))).sort((a,b)=>a.order-b.order);
    const first=trials[0].calls[0];assert.equal(first.spawned,true);assert.equal(first.accepted,false);assert.equal(first.identityChecks.before,'verified');assert.equal(first.identityChecks.after,'rejected');assert.equal(first.output.model,'invented-verified-model');assert.ok(first.outputBytes>0);assert.match(first.error,/Worker identity drift/);
    for(const row of trials.slice(1)){assert.equal(row.calls.length,1);assert.equal(row.calls[0].spawned,false);assert.equal(row.calls[0].identityChecks.before,'rejected');assert.match(row.error,/Worker identity drift/);}
  }
});
test('relative repository script paths fail preflight from trial cwd and preserve a failure receipt',async t=>{
  const root=temporary(t),output=path.join(root,'preflight'),dataset=defaultDataset();dataset.fixtures=dataset.fixtures.slice(0,2);
  await assert.rejects(evaluateLearning({output,agent:[process.execPath,'scripts/learning-evaluation.js'],identity:'fixture',dataset,repeat:1,maxCalls:12}),/ENOENT/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'preflight.json'))).complete,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'controller.json'))).controller.completed,false);
  assert.equal(fs.readdirSync(output).some(file=>file.startsWith('trial-')),false);
});
