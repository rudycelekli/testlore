import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callAgent } from '../src/swarm.js';
import { fixture } from './helpers.js';
test('agent transport carries identical deadline and byte budgets and kills descendants at timeout',async t=>{
 const root=fixture(t,{'worker.mjs':"import fs from 'node:fs';import {spawn} from 'node:child_process';spawn(process.execPath,['-e',`setTimeout(()=>require('fs').writeFileSync('descendant-alive','yes'),900)`],{stdio:'ignore'});setTimeout(()=>{},2000);"});
 await assert.rejects(callAgent([process.execPath,'worker.mjs'],{},root,200,{maxOutputBytes:4096}),/timed out/);
 await new Promise(resolve=>setTimeout(resolve,1000));assert.equal(fs.existsSync(path.join(root,'descendant-alive')),false);
});
test('agent rejects excessive transport output while valid workers receive propagated budgets',async t=>{
 const root=fixture(t,{'echo.mjs':"let text='';for await(const b of process.stdin)text+=b;console.log(JSON.stringify(JSON.parse(text).transportBudget));",'huge.mjs':"console.log(JSON.stringify({x:'x'.repeat(10000)}));"});
 const result=await callAgent([process.execPath,'echo.mjs'],{},root,1000,{maxOutputBytes:4096});assert.equal(result.timeoutMs,1000);assert.equal(result.maxOutputBytes,4096);assert.ok(result.deadlineAt>Date.now()-1000);
 await assert.rejects(callAgent([process.execPath,'huge.mjs'],{},root,1000,{maxOutputBytes:4096}),/byte budget/);
});
test('successful workers cannot leave a background descendant that writes after protocol acceptance',async t=>{
 const root=fixture(t,{'success.mjs':"import {spawn} from 'node:child_process';spawn(process.execPath,['-e',`setTimeout(()=>require('fs').writeFileSync('late-write','yes'),400)`],{stdio:'ignore'}).unref();console.log(JSON.stringify({accepted:true}));"});
 assert.equal((await callAgent([process.execPath,'success.mjs'],{},root,1000)).accepted,true);await new Promise(resolve=>setTimeout(resolve,500));assert.equal(fs.existsSync(path.join(root,'late-write')),false);
});
