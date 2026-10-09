import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayNativeAgentRepair} from '../scripts/agent-repair-frozen-replay.js';

test('native repair frozen replay retains success scope, earlier rejection and unknown cost',()=>{
 const result=replayNativeAgentRepair();assert.equal(result.verifiedRawMembers,18);assert.equal(result.recordedNativeRoleCalls,3);assert.equal(result.final.passed,8);assert.equal(result.priorScopeRejected,true);assert.equal(result.exactToolSourcePreregistered,false);assert.equal(result.publicLocalHmacVerifiable,false);assert.equal(result.tokens,null);assert.equal(result.currencyCost,null);assert.equal(result.livePRPublished,false);assert.equal(result.superiorityEstablished,false);
});
test('native repair replay rejects altered raw receipt without provider execution',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-agent-frozen-')),source=fileURLToPath(new URL('../benchmarks/agent-source-repair/native-codex-20261009/',import.meta.url));
 try{for(const file of fs.readdirSync(source))if(fs.lstatSync(path.join(source,file)).isFile())fs.copyFileSync(path.join(source,file),path.join(directory,file));const file=path.join(directory,'result.json'),text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replace('ready-for-review','ready-for-merges'));assert.throws(()=>replayNativeAgentRepair(directory),/member changed/);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
