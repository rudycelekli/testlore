import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {oneCommandEvidenceComplete,verifyOneCommandRawEvidence} from '../scripts/one-command-proof.js';
import {oneCommandFixture} from './one-command-evidence-fixture.js';

test('one-command evaluator requires real-install boundaries, shadow outcomes and retained disabled choices',()=>{
 const evidence=oneCommandFixture();assert.equal(oneCommandEvidenceComplete(evidence),true);
 for(const key of ['isolatedProfiles','isolatedCache','installedCacheBindingVerified','originalAssertionsPreserved','explicitDisabledPreserved'])for(const value of [false,undefined,'true'])assert.equal(oneCommandEvidenceComplete({...evidence,[key]:value}),false);
 for(const key of ['liveProviders','liveGitHub','registryPublicationVerified','coldTimingClaim'])assert.equal(oneCommandEvidenceComplete({...evidence,[key]:true}),false);
 const disabled=structuredClone(evidence);disabled.disabled.plugins.decisions.find(item=>item.id==='agentic-qe').action='enable';assert.equal(oneCommandEvidenceComplete(disabled),false);
});

test('one-command evaluator preserves expected native failure and rejects incomplete or renamed successes',()=>{
 const evidence=oneCommandFixture();
 for(const change of [{complete:false},{exitCode:1},{shadow:false},{signal:'SIGKILL'},{reportErrors:['missing report']},{tests:[]},{executedFiles:{}},{executedFiles:['test/a.test.js']}])assert.equal(oneCommandEvidenceComplete({...evidence,default:{...evidence.default,verification:{...evidence.default.verification,...change}}}),false);
 for(const change of [{exitCode:0},{verification:{...evidence.negative.verification,complete:false}},{verification:{...evidence.negative.verification,tests:evidence.default.verification.tests}}])assert.equal(oneCommandEvidenceComplete({...evidence,negative:{...evidence.negative,...change}}),false);
 assert.equal(oneCommandEvidenceComplete({...evidence,rawEvidence:[]}),false);
});

test('one-command raw verification rejects changed bytes, omitted evidence and symlinks',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-one-command-')),evidence=oneCommandFixture(),digest=content=>createHash('sha256').update(content).digest('hex'),raw={};
 raw['installed-manifest.json']=JSON.stringify({name:'testlore',gitHead:evidence.sourceRevision});evidence.installedManifestSha256=digest(raw['installed-manifest.json']);
 raw['installation.json']=JSON.stringify({archiveSha256:evidence.archiveSha256,sourceRevision:evidence.sourceRevision,installedManifestSha256:evidence.installedManifestSha256,installedCliSha256:evidence.installedCliSha256,cacheInstallations:1,npmExecCacheInstallationObserved:true,environmentCredentialsPassed:false});
 raw['preregistration.json']=JSON.stringify({archiveSha256:evidence.archiveSha256,sourceRevision:evidence.sourceRevision});
 for(const name of ['default','disabled','negative']){raw[name+'-stdout.json']=JSON.stringify(evidence[name]);raw[name+'-stderr.log']='';raw[name+'-process.json']=JSON.stringify({exitCode:name==='negative'?1:0,reason:null,signal:null});raw[name+'-config.json']=JSON.stringify({adapter:'node',executionMode:'shadow',plugins:{c8:{enabled:false},'agentic-qe':{enabled:false}}});}
 try{for(const item of evidence.rawEvidence){const content=raw[item.file];fs.writeFileSync(path.join(directory,item.file),content);item.sha256=digest(content);item.bytes=Buffer.byteLength(content);}
  assert.equal(verifyOneCommandRawEvidence(directory,evidence),true);
  const changed=structuredClone(evidence);changed.default.plugins.decisions[0].reasons=['Unsupported invented reason'];assert.equal(oneCommandEvidenceComplete(changed),true);assert.throws(()=>verifyOneCommandRawEvidence(directory,changed),/raw result and summary disagree/);
  fs.writeFileSync(path.join(directory,'default-stdout.json'),raw['default-stdout.json'].replace('passed','failed'));assert.throws(()=>verifyOneCommandRawEvidence(directory,evidence),/raw evidence changed/);
  fs.unlinkSync(path.join(directory,'default-stdout.json'));fs.symlinkSync(path.join(directory,'disabled-stdout.json'),path.join(directory,'default-stdout.json'));assert.throws(()=>verifyOneCommandRawEvidence(directory,evidence),/raw evidence size changed/);
  assert.throws(()=>verifyOneCommandRawEvidence(directory,{rawEvidence:[]}));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
