import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {captureInstalledUnimportInputs,captureUnimportRuntimeEvidence,assertUnimportRuntimeEvidence,assertFreshUnimportRuntimeEvidence} from '../src/unimport-runtime-evidence.js';
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
