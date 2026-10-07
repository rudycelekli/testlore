import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fixture,write} from './helpers.js';
const moduleURL=new URL('../src/execution.js',import.meta.url).href;
function rejectInChild(root) {
  const script=`import {combinedNativePlanningSupported,resolveNativeBatch} from ${JSON.stringify(moduleURL)};
    const root=${JSON.stringify(root)},config={adapter:'vitest',discovery:'native',runner:[process.execPath,'node_modules/vitest/vitest.mjs','run','{files}']};
    if(combinedNativePlanningSupported(root,config))throw new Error('Unexpected authority');
    const result=resolveNativeBatch(root,[],config,{discover:true,transitive:true});
    if(result.complete)throw new Error('Unexpected completeness');console.log('bounded-rejection');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:3000,maxBuffer:256*1024,killSignal:'SIGKILL'});
  assert.equal(child.error,undefined,child.error?.message);assert.equal(child.status,0,child.stderr);
  assert.equal(child.stdout.trim(),'bounded-rejection');
}
for(const kind of ['cli-fifo','metadata-fifo','oversized-cli','oversized-metadata','metadata-symlink'])
test(`native identity guard rejects ${kind} without blocking package resolution`,t=>{
  const root=fixture(t,{'package.json':{type:'module'},'node_modules/vitest/package.json':{name:'vitest',version:'5.0.2',bin:{vitest:'./vitest.mjs'},exports:{'./package.json':'./package.json'}},'node_modules/vitest/vitest.mjs':'#!/usr/bin/env node\n'});
  const cli=path.join(root,'node_modules/vitest/vitest.mjs'),metadata=path.join(root,'node_modules/vitest/package.json');
  if(kind.endsWith('fifo')){const target=kind==='cli-fifo'?cli:metadata;fs.unlinkSync(target);execFileSync('mkfifo',[target]);}
  else if(kind.startsWith('oversized'))fs.writeFileSync(kind==='oversized-cli'?cli:metadata,Buffer.alloc(1024*1024+1,32));
  else {fs.unlinkSync(metadata);write(root,'external-metadata.json',{name:'vitest',version:'5.0.2'});fs.symlinkSync(path.join(root,'external-metadata.json'),metadata);}
  rejectInChild(root);
});
