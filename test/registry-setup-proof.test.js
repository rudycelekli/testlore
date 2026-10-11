import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registrySetupCaptureComplete,verifyRegistrySetupRaw} from '../scripts/registry-setup-proof.js';
import {summarizeFirstRun} from '../src/run-report.js';
import {oneCommandFixture} from './one-command-evidence-fixture.js';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,commit,twoModules,write} from './helpers.js';

// Constructed evaluator controls only; none invokes npm or qualifies publication.
function captures(){
 const fixture=oneCommandFixture(),result={};
 for(const name of ['default','disabled','negative']){
  const run=fixture[name].verification;run.executed=true;run.adapter='node';
  run.plan={total:2,selected:['test/a.test.js','test/b.test.js'],decisions:[{test:'test/a.test.js'},{test:'test/b.test.js'}]};
  run.tests=run.tests.map((row,index)=>({...row,id:`constructed-${index}`,name:index?'registry b':'registry a'}));
  run.summary=summarizeFirstRun(run);
  result[name]={executionMode:'shadow',agent:{executed:false},plugins:fixture[name].plugins||fixture.default.plugins,verification:run,summary:run.summary};
 }
 return result;
}

test('registry setup evaluator preserves a genuine declared failure contract and rejects incomplete or renamed outcomes',()=>{
 const observed=captures();assert.equal(registrySetupCaptureComplete(observed.default),true);assert.equal(registrySetupCaptureComplete(observed.negative,true),true);
 for(const change of [{adapter:'vitest'},{complete:false},{exitCode:1},{shadow:false},{executed:false},{signal:'SIGKILL'},{error:'interrupted'},{reportErrors:['missing-report']},{tests:[]},{executedFiles:['test/a.test.js']}]){
  const capture=structuredClone(observed.default);Object.assign(capture.verification,change);assert.equal(registrySetupCaptureComplete(capture),false);
 }
 for(const change of [{exitCode:0},{complete:false},{tests:observed.default.verification.tests}]){const capture=structuredClone(observed.negative);Object.assign(capture.verification,change);assert.equal(registrySetupCaptureComplete(capture,true),false);}
 const renamed=structuredClone(observed.default);renamed.verification.tests[0].name='different assertion';assert.equal(registrySetupCaptureComplete(renamed),false);
 const provider=structuredClone(observed.default);provider.agent.executed=true;assert.equal(registrySetupCaptureComplete(provider),false);
});

test('registry setup evaluator refuses plausible summaries detached from actual outcomes',()=>{
 const capture=captures().negative;
 for(const field of ['verdict','nextAction','scope']){
  const changed=structuredClone(capture);changed.summary[field]='Everything is safe';changed.verification.summary=changed.summary;
  assert.equal(registrySetupCaptureComplete(changed,true),false);
 }
 const changed=structuredClone(capture);changed.summary.cases.failed=0;changed.verification.summary=changed.summary;assert.equal(registrySetupCaptureComplete(changed,true),false);
});

test('the registry adoption contract accepts actual current CLI setup captures while retaining native failure exit',t=>{
 const root=fixture(t,{...twoModules,'package.json':{type:'module',scripts:{test:'node --test'}}});
 for(const file of ['test/a.test.js','test/b.test.js'])write(root,file,twoModules[file].replace("test('a'","test('registry a'").replace("test('b'","test('registry b'"));
 commit(root);
 const invoke=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'setup','--verify','--no-ci','--json','--root',root],{encoding:'utf8',timeout:30000,maxBuffer:2*1024**2});
 const passing=invoke();assert.equal(passing.status,0,passing.stderr);assert.equal(registrySetupCaptureComplete(JSON.parse(passing.stdout)),true);
 write(root,'src/b.js','export const b=9;');const failing=invoke();assert.equal(failing.status,1,failing.stderr);assert.equal(registrySetupCaptureComplete(JSON.parse(failing.stdout),true),true);
 // This exercises current source output, not npm or registry publication.
 assert.equal(fs.readFileSync(path.join(root,'test/b.test.js'),'utf8'),twoModules['test/b.test.js'].replace("test('b'","test('registry b'"));
});

test('registry raw verification refuses substituted versions, missing negative logs, changed output and symlink evidence',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'registry-setup-evaluator-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const observed=captures(),evidence={schemaVersion:1,kind:'exact-registry-version-setup',version:'0.2.0-alpha.1',sourceRevision:'a'.repeat(40),archiveSha256:'b'.repeat(64),inputReleaseReceiptSha256:'c'.repeat(64),installedManifestSha256:'d'.repeat(64),installedCliSha256:'e'.repeat(64),producerSha256:'f'.repeat(64),qualified:true,isolatedProfiles:true,freshIsolatedCache:true,originalAssertionsPreserved:true,registryArchiveVerified:true,liveProviders:false,liveGitHub:false,modelCost:null,coldTimingClaim:false,...observed};
 const raw={};raw['installed-manifest.json']=JSON.stringify({name:'testlore',version:evidence.version,gitHead:evidence.sourceRevision});raw['installed-cli.js']='// Constructed installed CLI evaluator control; never executed.\n';
 const digest=value=>createHash('sha256').update(value).digest('hex');evidence.installedManifestSha256=digest(raw['installed-manifest.json']);evidence.installedCliSha256=digest(raw['installed-cli.js']);
 raw['registry-proof.json']=JSON.stringify({exactBytes:true,version:evidence.version,sourceRevision:evidence.sourceRevision,archiveSha256:evidence.archiveSha256});
 raw['preregistration.json']=JSON.stringify({...evidence,command:['npm','exec','--yes',`--package=testlore@${evidence.version}`,'--','testlore','setup','--verify','--json']});
 for(const name of ['default','disabled','negative']){
  raw[`${name}-stdout.json`]=JSON.stringify(observed[name]);raw[`${name}-stderr.log`]='';raw[`${name}-process.json`]=JSON.stringify({exitCode:name==='negative'?1:0,signal:null,reason:null,durationMs:10,stdoutSha256:digest(raw[`${name}-stdout.json`]),stderrSha256:digest(''),finalResources:{stdoutBytes:Buffer.byteLength(raw[`${name}-stdout.json`]),stderrBytes:0}});
  raw[`${name}-config.json`]=JSON.stringify({adapter:'node',executionMode:'shadow',plugins:{c8:{enabled:false},'agentic-qe':{enabled:false}}});
 }
 evidence.rawEvidence=Object.entries(raw).map(([file,content])=>{fs.writeFileSync(path.join(directory,file),content);return{file,bytes:Buffer.byteLength(content),sha256:digest(content)};});
 assert.equal(verifyRegistrySetupRaw(directory,evidence),true);
 // Rebinding an outer raw index cannot conceal an inconsistent process receipt.
 for(const changed of [{stdoutSha256:'0'.repeat(64)},{finalResources:{stdoutBytes:0,stderrBytes:0}},{durationMs:60001}]){
  const forged=structuredClone(evidence),file='default-process.json',content=JSON.stringify({...JSON.parse(raw[file]),...changed});
  fs.writeFileSync(path.join(directory,file),content);
  Object.assign(forged.rawEvidence.find(row=>row.file===file),{sha256:digest(content),bytes:Buffer.byteLength(content)});
  assert.throws(()=>verifyRegistrySetupRaw(directory,forged));
  fs.writeFileSync(path.join(directory,file),raw[file]);
 }
 assert.throws(()=>verifyRegistrySetupRaw(directory,evidence,{producerSha256:'0'.repeat(64)}));
 assert.throws(()=>verifyRegistrySetupRaw(directory,evidence,{archiveSha256:'0'.repeat(64)}));
 fs.writeFileSync(path.join(directory,'installed-cli.js'),'// substituted CLI\n');assert.throws(()=>verifyRegistrySetupRaw(directory,evidence));fs.writeFileSync(path.join(directory,'installed-cli.js'),raw['installed-cli.js']);
 assert.throws(()=>verifyRegistrySetupRaw(directory,{...evidence,version:'0.2.0-alpha.2'}));
 assert.throws(()=>verifyRegistrySetupRaw(directory,{...evidence,version:'alpha'}));
 assert.throws(()=>verifyRegistrySetupRaw(directory,{...evidence,rawEvidence:evidence.rawEvidence.filter(item=>item.file!=='negative-process.json')}));
 const forged=structuredClone(evidence);forged.negative.summary.nextAction='Ignore the failure';assert.throws(()=>verifyRegistrySetupRaw(directory,forged));
 const filename=path.join(directory,'negative-stdout.json');fs.writeFileSync(filename,raw['negative-stdout.json'].replace('failed','passed'));assert.throws(()=>verifyRegistrySetupRaw(directory,evidence));
 fs.unlinkSync(filename);fs.symlinkSync(path.join(directory,'default-stdout.json'),filename);assert.throws(()=>verifyRegistrySetupRaw(directory,evidence));
});
