#!/usr/bin/env node
// Opt-in native subscription transport; records local usage and never exposes keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {codexRequest,runCodex} from '../src/adapters/codex.js';
import {safeHostEnvironment} from './host-qualification.js';
let text='',bytes=0;
for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>256*1024)throw Error('Input budget exceeded');text+=chunk;}
const payload=JSON.parse(text),directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-paired-worker-'));
let receipt;
try{
 const target=process.argv[2];if(!target||!path.isAbsolute(target)||!fs.statSync(target).isDirectory()||!['repair-architect','repair-author','repair-reviewer'].includes(payload.role))throw Error('Explicit receipt directory and known role required');
 receipt=path.join(target,payload.role+'.json');if(fs.existsSync(receipt))throw Error('Fresh receipt required');
 const {args,prompt}=codexRequest(payload,directory);
 const result=await runCodex(args,prompt,directory,safeHostEnvironment(process.env),payload.transportBudget);
 fs.writeFileSync(receipt,JSON.stringify({role:payload.role,payload,status:'completed',result}),{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify(result.value));
}catch(error){
 if(receipt&&!fs.existsSync(receipt))fs.writeFileSync(receipt,JSON.stringify({role:payload.role,payload,status:'failed',failureCode:typeof error.code==='string'?error.code:'WORKER_FAILURE',nativeUsage:null,billingUSD:null}),{flag:'wx',mode:0o600});
 process.stderr.write('Native paired worker failed; private receipt retained.\n');process.exitCode=1;
}finally{fs.rmSync(directory,{recursive:true,force:true});}
