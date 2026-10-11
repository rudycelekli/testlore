import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers.js';
import {main} from '../src/cli.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const exec=(root,...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:20000});
function setup(t){
  const record={number:7,title:'Fix Unicode surrogate encoding',url:'https://github.com/upstream/library/pull/7',state:'MERGED',isDraft:false,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-02T00:00:00Z',mergedAt:'2026-09-02T00:00:00Z',baseRefOid:'a'.repeat(40),headRefOid:'b'.repeat(40),author:{login:'rudycelekli'},mergedBy:{login:'upstream'},repository:{nameWithOwner:'upstream/library',owner:{login:'upstream'},isPrivate:false,isFork:false,url:'https://github.com/upstream/library'},additions:3,deletions:1,changedFiles:1};
  const snapshot={schemaVersion:1,kind:'public-authored-pr-snapshot',author:'rudycelekli',capturedAt:'2026-10-11T00:00:00Z',coverage:{complete:true,reportedCount:1,returnedCount:1,query:'is:pr is:public author:rudycelekli'},pullRequests:[record]};
  const raw=JSON.stringify(snapshot),sha=createHash('sha256').update(raw).digest('hex');
  const root=fixture(t,{'snapshot.json':raw,'contract.md':'Unicode surrogate encoding must match the independent specification.','tddswarm.config.json':{runner:[process.execPath,'--eval',"require('fs').writeFileSync('EXECUTED','bad')"]}});
  return {root,sha};
}
test('source CLI imports exact bytes, retrieves bounded advice and reflects without executing project code',t=>{
  const {root,sha}=setup(t);
  const imported=exec(root,'knowledge-import','--report','snapshot.json','--sha256',sha,'--json');
  assert.equal(imported.status,0,imported.stderr);assert.equal(JSON.parse(imported.stdout).records,1);
  const queried=exec(root,'knowledge','--query','encoding','--contract','contract.md','--json');
  assert.equal(queried.status,0,queried.stderr);const result=JSON.parse(queried.stdout);
  assert.equal(result.records[0].url,'https://github.com/upstream/library/pull/7');assert.equal(result.authority,'none');assert.ok(Buffer.byteLength(JSON.stringify(result))<=6000);
  const excluded=exec(root,'knowledge','--query','encoding','--contract','contract.md','--exclude-repositories','upstream/library','--json');
  assert.equal(excluded.status,0);assert.equal(JSON.parse(excluded.stdout).records.length,0);
  const reflected=exec(root,'knowledge-reflect');assert.equal(reflected.status,0);assert.match(reflected.stdout,/1 merged/);assert.match(reflected.stdout,/unproven/);
  assert.equal(fs.existsSync(path.join(root,'EXECUTED')),false);
});
test('CLI declines hash mismatch, incomplete arguments and irrelevant execution flags',t=>{
  const {root,sha}=setup(t);
  for(const args of [ ['knowledge-import','--report','snapshot.json','--sha256','c'.repeat(64)],['knowledge-import','--report','snapshot.json'],['knowledge','--query','encoding'],['knowledge-reflect','--execute'],['audit','--sha256',sha] ])assert.equal(exec(root,...args).status,2,args.join(' '));
  assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
});
test('contract reads reject symlinks, directories, invalid UTF-8 and oversized files',t=>{
  const {root}=setup(t);
  fs.symlinkSync(path.join(root,'contract.md'),path.join(root,'linked.md'));
  fs.mkdirSync(path.join(root,'directory'));fs.writeFileSync(path.join(root,'large.md'),'€'.repeat(6000));fs.writeFileSync(path.join(root,'invalid.md'),Buffer.from([255]));
  for(const file of ['linked.md','directory','large.md','invalid.md','../contract.md'])assert.equal(exec(root,'knowledge','--query','encoding','--contract',file).status,2,file);
});
test('unavailable knowledge yields actionable abstention, corrupt knowledge fails closed',t=>{
  const {root,sha}=setup(t);
  const absent=exec(root,'knowledge','--query','encoding','--contract','contract.md','--json');assert.equal(absent.status,0);assert.equal(JSON.parse(absent.stdout).reason,'no-contribution-knowledge');
  assert.equal(exec(root,'knowledge-import','--report','snapshot.json','--sha256',sha).status,0);
  fs.writeFileSync(path.join(root,'.tddswarm/learning/contributions/index.json'),'{}');
  assert.equal(exec(root,'knowledge-reflect','--json').status,2);
  assert.equal(exec(root,'knowledge','--query','encoding','--contract','contract.md','--json').status,2);
});
test('a contract rewritten during admission cannot silently become retrieval input',async t=>{
  const {root}=setup(t),file=path.join(root,'contract.md'),inode=fs.statSync(file).ino,read=fs.readSync;
  let changed=false;
  fs.readSync=function(fd,...args){const count=read.call(fs,fd,...args);if(!changed&&fs.fstatSync(fd).ino===inode){changed=true;fs.writeFileSync(file,'Unicode changed expectation');}return count;};
  try{await assert.rejects(main(['knowledge','--root',root,'--query','encoding','--contract','contract.md','--json']),/Contract changed during bounded admission/);assert.equal(changed,true);}finally{fs.readSync=read;}
});
