#!/usr/bin/env node
/** Actual bounded package-manager installation on constructed fixtures, never an upstream bug claim. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/provenance.js';
import {fileIdentity} from './worker-identity.js';
import {freezePublicCandidates} from './public-corpus.js';
import {installUpstreamCandidate,verifyUpstreamInstallation} from './public-corpus-upstream.js';

const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export async function proveUpstreamManagers(directory){
 directory=path.resolve(directory);if(fs.existsSync(directory))throw Error('Output must be new; preserve earlier evidence');fs.mkdirSync(directory,{mode:0o700,recursive:true});directory=fs.realpathSync(directory);const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-manager-proof-'));fs.chmodSync(scratch,0o700);
 const producer=fileIdentity(fileURLToPath(import.meta.url)),installer=fileIdentity(fileURLToPath(new URL('./public-corpus-upstream.js',import.meta.url))),fixtureLock=fileIdentity(fileURLToPath(new URL('./fixtures/upstream-manager/pnpm-12.3.4-lock.yaml',import.meta.url)),8192),rows=[];
 save(path.join(directory,'scratch.json'),{scratch,scope:'Constructed fixture, actual pinned manager and lifecycle execution. No genuine upstream or routing qualification.'});
 for(const [version,expectedExecution]of [['10.33.0','node'],['12.3.4','native']]){
  const id='manager-'+version.replaceAll('.','-'),checkout=path.join(scratch,id);fs.mkdirSync(checkout);
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',checkout,...args],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024}).trim();
  git('init','-q');git('config','user.name','TestLore proof');git('config','user.email','proof@example.invalid');git('remote','add','origin','https://github.com/example/constructed-manager-proof');
  fs.mkdirSync(path.join(checkout,'src'));fs.mkdirSync(path.join(checkout,'test'));
  fs.writeFileSync(path.join(checkout,'.gitignore'),'node_modules/\n.tddswarm/\n');
  fs.writeFileSync(path.join(checkout,'package.json'),JSON.stringify({name:id,version:'1.0.0',private:true,type:'module',packageManager:'pnpm@'+version,scripts:{postinstall:'node install-proof.cjs'}})+'\n');
  fs.writeFileSync(path.join(checkout,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n");
  if(expectedExecution==='native')fs.copyFileSync(fileURLToPath(new URL('./fixtures/upstream-manager/pnpm-12.3.4-lock.yaml',import.meta.url)),path.join(checkout,'pnpm-lock.yaml'));
  fs.writeFileSync(path.join(checkout,'install-proof.cjs'),"const fs=require('node:fs');fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/lifecycle-proof.json',JSON.stringify({kind:'actual-project-lifecycle',node:process.version,value:require('node:fs').readFileSync('src/value.js','utf8')}));\n");
  fs.writeFileSync(path.join(checkout,'test/value.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.js';test('installed native value',()=>assert.equal(value,42));\n");
  fs.writeFileSync(path.join(checkout,'src/value.js'),'export const value=43;\n');git('add','.');git('commit','-qm','Prior constructed source');const parent=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(checkout,'src/value.js'),'export const value=42;\n');git('add','.');git('commit','-qm','Fixed constructed source');const fixed=git('rev-parse','HEAD');
  const selection=freezePublicCandidates({candidates:[{id,repository:'https://github.com/example/constructed-manager-proof',fixRevision:fixed,parentRevision:parent,treeRevision:git('rev-parse','HEAD^{tree}'),status:'unmeasured',kind:'public-bugfix-inversion-candidate',blockers:['Constructed installation control only'],sourcePaths:['src/value.js'],maintainerOraclePaths:[],changedFiles:[{path:'src/value.js',headGitBlob:git('rev-parse','HEAD:src/value.js'),patchSha256:digest(git('diff',parent,fixed,'--','src/value.js'))}],runtimeIdentity:{packageManager:'pnpm@'+version},byteBindings:['package.json','pnpm-lock.yaml'].map(file=>({kind:'dependency',path:file,gitBlob:git('rev-parse','HEAD:'+file),bytes:fs.statSync(path.join(checkout,file)).size,sha256:digest(fs.readFileSync(path.join(checkout,file)))}))}],accounting:[{scope:'Constructed manager compatibility, not a public contribution or bug benchmark'}]});
  save(path.join(directory,id+'-selection.json'),selection);
  const installationDirectory=path.join(scratch,id+'-installation'),receipt=await installUpstreamCandidate({selection,id,checkout,directory:installationDirectory});save(path.join(directory,id+'-receipt.json'),receipt);const raw=path.join(directory,id+'-evidence');fs.mkdirSync(raw);for(const file of ['input.json','bootstrap.json','bootstrap/stdout.log','bootstrap/stderr.log','manager-version.json','manager-version/stdout.log','manager-version/stderr.log','install.json','install/stdout.log','install/stderr.log','receipt.json','installed-inventory.json']){const source=path.join(installationDirectory,file);if(fs.existsSync(source)){const dest=path.join(raw,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}}
  assert.equal(receipt.status,'completed',receipt.error);assert.equal(receipt.managerExecution,expectedExecution);assert.equal(receipt.upstreamLockInstallationVerified,true);
  const verified=verifyUpstreamInstallation(selection,id,receipt.project,path.join(installationDirectory,'receipt.json'),digest(fs.readFileSync(path.join(installationDirectory,'receipt.json'))));assert.equal(verified.status,'completed');
  const lifecycle=JSON.parse(fs.readFileSync(path.join(receipt.project,'node_modules/lifecycle-proof.json')));assert.equal(lifecycle.kind,'actual-project-lifecycle');assert.equal(lifecycle.node,process.version);assert.equal(lifecycle.value,'export const value=42;\n');
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','test/value.test.js'],{cwd:receipt.project,env:{HOME:scratch,PATH:path.dirname(process.execPath)+path.delimiter+'/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(directory,id+'.tap'),result.stdout||'',{flag:'wx'});fs.writeFileSync(path.join(directory,id+'.stderr'),result.stderr||'',{flag:'wx'});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.match(result.stdout,/# tests 1\n/);assert.match(result.stdout,/# pass 1\n/);assert.match(result.stdout,/# skipped 0\n/);
  verifyUpstreamInstallation(selection,id,receipt.project,path.join(installationDirectory,'receipt.json'),digest(fs.readFileSync(path.join(installationDirectory,'receipt.json'))));
  rows.push({version,execution:receipt.managerExecution,manager:receipt.manager,managerMetadata:receipt.managerMetadata,managerVersion:receipt.managerVersion,actualLifecycle:true,nativeCasesPassed:1,nativeStdoutSha256:digest(result.stdout),installedTree:receipt.installedTree});
 }
 assert.deepEqual(fileIdentity(producer.path),producer);assert.deepEqual(fileIdentity(installer.path),installer);assert.deepEqual(fileIdentity(fixtureLock.path,8192),fixtureLock);
 const summary={kind:'actual-pinned-manager-constructed-installation-proof',qualified:true,producer,installer,fixtureLock,node:process.version,rows,limitations:['Two constructed dependency-free project installations and actual lifecycle/native cases; no full upstream installation, bug-detection, speed, learning or security-sandbox claim.','Pinned package metadata, executable hashes and version output do not attest the complete transitive manager runtime or package provenance.','POSIX native executable profile only; Windows remains unsupported.']};save(path.join(directory,'summary.json'),summary);return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4||process.argv[2]!=='--output')throw Error('Use --output NEW_PRIVATE_DIRECTORY');const result=await proveUpstreamManagers(process.argv[3]);console.log(JSON.stringify({qualified:result.qualified,rows:result.rows.map(({version,execution,actualLifecycle,nativeCasesPassed})=>({version,execution,actualLifecycle,nativeCasesPassed}))},null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
