import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {captureInstalledUnimportInputs,captureUnimportInstallationContract,captureUnimportRuntimeEvidence,assertUnimportRuntimeEvidence,assertFreshUnimportRuntimeEvidence} from '../src/unimport-runtime-evidence.js';
function installed(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-original-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'node_modules/package'),{recursive:true});fs.writeFileSync(path.join(root,'node_modules/package/main.js'),'export const value=1;');fs.writeFileSync(path.join(root,'node_modules/package/native.node'),Buffer.from([0,1,2,3]));return root;}
test('original installed closure includes native bytes and internal link origins, deterministically',t=>{
 const root=installed(t);fs.symlinkSync('package',path.join(root,'node_modules/alias'));const first=captureInstalledUnimportInputs(root),second=captureInstalledUnimportInputs(root);assert.deepEqual(first,second);assert.equal(first.length,3);assert.equal(first[0].kind,'symlink');assert.equal(first[0].canonicalTarget,'node_modules/package');assert.ok(first.some(row=>row.file.endsWith('/native.node')&&row.size===4&&/^[a-f0-9]{64}$/.test(row.sha256)));
 fs.writeFileSync(path.join(root,'node_modules/package/native.node'),Buffer.from([0,1,2,4]));assert.notDeepEqual(captureInstalledUnimportInputs(root),first);assert.throws(()=>assertUnimportRuntimeEvidence(first,captureInstalledUnimportInputs(root)),/evidence changed/);
});
test('external links, invalid entry names and inventory overruns refuse runtime closure',t=>{
 const root=installed(t);fs.symlinkSync(os.tmpdir(),path.join(root,'node_modules/outside'));assert.throws(()=>captureInstalledUnimportInputs(root),/escapes reviewed root/);fs.unlinkSync(path.join(root,'node_modules/outside'));assert.throws(()=>captureInstalledUnimportInputs(root,{maxBytes:1}),/bytes exceed/);assert.throws(()=>captureInstalledUnimportInputs(root,{maxEntries:1}),/budget exceeded/);fs.writeFileSync(path.join(root,'node_modules/bad\nname'),'');assert.throws(()=>captureInstalledUnimportInputs(root),/Invalid installed runtime entry/);
});
test('public installed rows cannot mutate private live inventory or poison later captures',t=>{
 const root=installed(t),first=captureInstalledUnimportInputs(root),original=structuredClone(first);assert.ok(Object.isFrozen(first));assert.ok(first.every(Object.isFrozen));assert.throws(()=>first[0].sha256='0'.repeat(64),TypeError);assert.throws(()=>first.push({file:'forged'}),TypeError);assert.deepEqual(captureInstalledUnimportInputs(root),original);
});
test('serialized claims cannot mint a live filesystem seal or authorize an unrelated profile',t=>{
 assert.equal(captureUnimportRuntimeEvidence('/unavailable',[],undefined),null);assert.equal(captureUnimportRuntimeEvidence('/unavailable',[],{profile:{profile:'e2e-locator-runtime-v1'}}),null);assert.throws(()=>assertFreshUnimportRuntimeEvidence({schemaVersion:1,digest:'0'.repeat(64)}),/Unminted/);assert.throws(()=>assertFreshUnimportRuntimeEvidence(JSON.parse('{"schemaVersion":1}')),/Unminted/);
});

function metadata(root){
 root=fs.realpathSync(root);
 const modules={packageManager:'pnpm@12.3.4',prunedAt:'Mon, 12 Oct 2026 15:02:04 GMT',storeDir:'/private/tmp/testlore-home/Library/pnpm/store/v11',allowBuilds:{esbuild:true}};
 const workspace={lastValidatedTimestamp:1791843805491,projects:{[root]:{name:'unimport',version:'7.0.2'},[root+'/playground']:{name:'playground'}},settings:{trustPolicy:'no-downgrade'}};
 const write=()=>{fs.writeFileSync(path.join(root,'node_modules/.modules.yaml'),JSON.stringify(modules,null,2));fs.writeFileSync(path.join(root,'node_modules/.pnpm-workspace-state-v1.json'),JSON.stringify(workspace,null,2)+'\n');};write();return {modules,workspace,write};
}
test('installer bookkeeping permits only scoped pre-capture reproducibility fields',t=>{
 const root=installed(t),m=metadata(root),first=captureInstalledUnimportInputs(root),contract=captureUnimportInstallationContract(root,first);
 m.modules.prunedAt='Tue, 13 Oct 2026 15:02:04 GMT';m.modules.storeDir='/private/tmp/another-home/Library/pnpm/store/v11';m.workspace.lastValidatedTimestamp++;m.write();
 const next=captureInstalledUnimportInputs(root);assert.notDeepEqual(first,next);assert.deepEqual(captureUnimportInstallationContract(root,next),contract);
 m.modules.allowBuilds.esbuild=false;m.write();assert.notDeepEqual(captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),contract);
 m.modules.allowBuilds.esbuild=true;m.workspace.settings.trustPolicy='ignore';m.write();assert.notDeepEqual(captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),contract);
 m.workspace.settings.trustPolicy='no-downgrade';m.write();fs.appendFileSync(path.join(root,'node_modules/package/main.js'),'export const changed=2;');assert.notDeepEqual(captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),contract);
});
test('metadata byte drift, copied inventory, duplicate keys and malformed fields are refused',t=>{
 const root=installed(t),m=metadata(root),rows=captureInstalledUnimportInputs(root);assert.throws(()=>captureUnimportInstallationContract(root,structuredClone(rows)),/privately captured/);
 m.workspace.lastValidatedTimestamp++;m.write();assert.throws(()=>captureUnimportInstallationContract(root,rows),/changed during capture/);
 const file=path.join(root,'node_modules/.modules.yaml');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"packageManager":','"packageManager": "pnpm@0",\n  "packageManager":'));assert.throws(()=>captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),/Noncanonical/);
 m.modules.storeDir='/tmp/../fake/pnpm/store/v11';m.write();assert.throws(()=>captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),/Unsupported/);
 m.modules.storeDir='/private/tmp/home/pnpm/store/v11';m.workspace.projects['/another/project']={};m.write();assert.throws(()=>captureUnimportInstallationContract(root,captureInstalledUnimportInputs(root)),/Unsupported/);
});
