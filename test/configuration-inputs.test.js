import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateConfigurationInputs,captureConfigurationInputs,admitsCanonicalTempDirectory} from '../src/configuration-inputs.js';
const {analyze,typescript:ts}=createRequire(import.meta.url)('../src/source-analysis.cjs');
const source=`import {realpathSync} from 'node:fs';import {tmpdir,availableParallelism} from 'node:os';const temp=realpathSync(tmpdir());export default {test:{env:{TMPDIR:temp},maxWorkers:Math.min(2,availableParallelism())}};`;
const admit=text=>admitsCanonicalTempDirectory(analyze('vitest.config.ts',text).ast,ts);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=()=>[{file:'vitest.config.ts',kind:'canonical-temp-directory',sourceSha256:hash(source)}];
test('only one direct, top-level constant canonicalization of Node tmpdir is admitted',()=>assert.equal(admit(source),true));
for(const [name,text]of Object.entries({
 arbitraryRead:source.replace('realpathSync(tmpdir())',"realpathSync('./settings')"),
 otherFilesystem:source.replace('{realpathSync}', '{realpathSync,readFileSync}'),
 duplicate:source+`const more=realpathSync(tmpdir());`,
 aliased:source.replace('realpathSync}', 'realpathSync as canonical}').replace('=realpathSync(', '=canonical('),
 reexport:source+`export {realpathSync};`,
 callback:source.replace('const temp=realpathSync(tmpdir())','const temp=()=>realpathSync(tmpdir())'),
 shadow:source+`function f(tmpdir){return tmpdir();}`,
 mutation:source+`Object.defineProperty(globalThis,'x',{value:1});`,
 network:source+`fetch('https://example.test');`,
 indirect:source+`const f=tmpdir;`,
 dynamic:source+`import(location);`,
 promiseFs:source+`import other from 'node:fs/promises';`,
 optional:source.replace('realpathSync(tmpdir())', 'realpathSync?.(tmpdir())')
}))test(`canonical input profile rejects ${name}`,()=>assert.equal(admit(text),false));
test('bounded source and fresh canonical target observations detect source, symlink and environment drift',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'testlore-config-input-')));
 try{
  fs.writeFileSync(path.join(root,'vitest.config.ts'),source);fs.mkdirSync(path.join(root,'a'));fs.mkdirSync(path.join(root,'b'));fs.symlinkSync(path.join(root,'a'),path.join(root,'link'));
  const config={configurationInputs:profile(),env:{TMPDIR:path.join(root,'link')}};
  const first=captureConfigurationInputs(root,config);assert.equal(first.warnings.length,0);assert.equal(first.observations[0].canonicalDirectory,path.join(root,'a'));
  fs.unlinkSync(path.join(root,'link'));fs.symlinkSync(path.join(root,'b'),path.join(root,'link'));
  assert.notDeepEqual(captureConfigurationInputs(root,config),first);
  assert.notDeepEqual(captureConfigurationInputs(root,{...config,env:{TMPDIR:path.join(root,'a')}}),first);
  fs.appendFileSync(path.join(root,'vitest.config.ts'),'\n// changed');assert.equal(captureConfigurationInputs(root,config).warnings[0].detail,'source-digest-mismatch');
  fs.unlinkSync(path.join(root,'vitest.config.ts'));fs.symlinkSync(path.join(root,'outside.ts'),path.join(root,'vitest.config.ts'));
  assert.equal(captureConfigurationInputs(root,config).observations.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects unknown profile keys, wildcards, traversal and duplicate source approvals',()=>{
 for(const value of [profile().concat(profile()),[{...profile()[0],closedWorld:true}],[{...profile()[0],file:'../vitest.config.ts'}],[{...profile()[0],file:'*.ts'}],[{...profile()[0],sourceSha256:'0'}],Array(17).fill(profile()[0])])assert.throws(()=>validateConfigurationInputs(value));
});

test('only exact previously observed TMPDIR canonicalization may pass worker freshness',async()=>{
 const {assertConfigurationInputFreshness}=await import('../src/configuration-inputs.js');
 const input={file:'vitest.config.ts',sourceSha256:hash(source),requestedDirectory:'/tmp-link',canonicalDirectory:'/canonical-temp',device:'1',inode:'2',environment:{TMPDIR:'/tmp-link',TMP:null,TEMP:null}};
 const before={schemaVersion:1,profile:'exact-canonical-temp-directory',observations:[input],warnings:[]};
 const canonical=structuredClone(before);canonical.observations[0].requestedDirectory='/canonical-temp';canonical.observations[0].environment.TMPDIR='/canonical-temp';
 assert.throws(()=>assertConfigurationInputFreshness(before,canonical));
 assert.equal(assertConfigurationInputFreshness(before,canonical,{allowCanonicalTmpdir:true}),true);
 for(const [key,value]of [['inode','3'],['sourceSha256','a'.repeat(64)],['canonicalDirectory','/other']]){const bad=structuredClone(canonical);bad.observations[0][key]=value;assert.throws(()=>assertConfigurationInputFreshness(before,bad,{allowCanonicalTmpdir:true}));}
 const bad=structuredClone(canonical);bad.observations[0].environment.TMP='/other';assert.throws(()=>assertConfigurationInputFreshness(before,bad,{allowCanonicalTmpdir:true}));
 assert.throws(()=>assertConfigurationInputFreshness(before,{...canonical,warnings:[{}]},{allowCanonicalTmpdir:true}));
});
