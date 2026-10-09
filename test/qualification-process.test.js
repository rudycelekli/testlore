import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {boundedInstallProcess} from '../scripts/qualification-process.js';

test('dependency-free bootstrap records real process output and interrupts deadline overruns',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-bootstrap-'));
 try{
  for(const name of ['success','timeout'])fs.mkdirSync(path.join(root,name));
  const env={PATH:process.env.PATH,LANG:'C',HOME:root};
  const success=await boundedInstallProcess(process.execPath,['-e',"process.stdout.write('observed')"],{cwd:root,directory:path.join(root,'success'),env,reserveBytes:1,maxGrowthBytes:1024**3,timeoutMs:3000,terminateDescendants:true});
  assert.equal(success.exitCode,0);assert.equal(success.reason,null);
  assert.match(success.stdoutSha256,/^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(root,'success/stdout.log'),'utf8'),'observed');
  const timeout=await boundedInstallProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,directory:path.join(root,'timeout'),env,reserveBytes:1,maxGrowthBytes:1024**3,timeoutMs:120,terminateDescendants:true});
  assert.equal(timeout.reason,'timeout');assert.notEqual(timeout.exitCode,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
