import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {snapshot,freshness,digest} from '../src/provenance.js';

test('configuration observations invalidate imported evidence after canonical target and source drift',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-config-provenance-')));
 try{
  const source="import {realpathSync} from 'node:fs';import {tmpdir} from 'node:os';const canonical=realpathSync(tmpdir());export default {test:{env:{TMPDIR:canonical}}};";
  fs.writeFileSync(path.join(root,'vitest.config.ts'),source);
  for(const name of ['a','b'])fs.mkdirSync(path.join(root,name));
  fs.symlinkSync(path.join(root,'a'),path.join(root,'temporary'));
  const config={env:{TMPDIR:path.join(root,'temporary')},configurationInputs:[{file:'vitest.config.ts',kind:'canonical-temp-directory',sourceSha256:digest(source)}]};
  const before=snapshot(root,config);
  assert.equal(freshness(before,snapshot(root,config)).fresh,true);
  fs.unlinkSync(path.join(root,'temporary'));fs.symlinkSync(path.join(root,'b'),path.join(root,'temporary'));
  assert.ok(freshness(before,snapshot(root,config)).reasons.includes('configuration-inputs-changed'));
  fs.appendFileSync(path.join(root,'vitest.config.ts'),'\n// drift');
  assert.ok(freshness(before,snapshot(root,config)).reasons.includes('configuration-input-unavailable'));
  const forged=structuredClone(before);forged.configurationInputs.observations[0].inode='forged';
  assert.deepEqual(freshness(forged,before).reasons,['invalid-provenance']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('legacy snapshots retain their original fingerprint shape without a configuration profile',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-config-legacy-')));
 try{
  fs.writeFileSync(path.join(root,'source.js'),'export const answer=42;');
  const before=snapshot(root);
  assert.equal(Object.hasOwn(before,'configurationInputs'),false);
  assert.equal(before.fingerprint,digest({files:before.files,runner:before.runner,services:before.services}));
  assert.equal(freshness(before,snapshot(root)).fresh,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
