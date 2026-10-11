import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const manifest={schemaVersion:1,campaignId:'missing-native',evidenceClass:'constructed-contract-test',attempts:[{id:'missing-baseline',repository:'https://github.com/example/library',baseRevision:'a'.repeat(40),fixedRevision:'b'.repeat(40),patchSha256:'c'.repeat(64),environmentSha256:'d'.repeat(64),attribution:{discovery:'manual-investigation',testloreContribution:['evidence-validation']}}]};
const invoke=(root,...args)=>spawnSync(process.execPath,[cli,'campaign','--root',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
test('CLI preserves missing native baseline as inconclusive with a non-success exit and no project execution',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-campaign-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'touch SHOULD_NOT_EXIST'}}));
 const r=invoke(root,'--manifest','manifest.json','--json');assert.equal(r.status,2,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.summary.inconclusive,1);assert.equal(report.summary.accepted,0);assert.equal(report.attempts[0].regressionQualified,false);assert.match(report.manifest.sha256,/^[a-f0-9]{64}$/);assert.equal(fs.existsSync(path.join(root,'SHOULD_NOT_EXIST')),false);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
});
test('CLI refuses execution switches and manifests outside the evidence root',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-campaign-options-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));
 for(const args of [['--manifest','manifest.json','--execute'],['--manifest','../manifest.json'],['--manifest','manifest.json','--output','report.json'],[]]){const r=invoke(root,...args);assert.equal(r.status,2);assert.match(r.stderr,/accepts only|Unsafe|escapes|--manifest is required/);}
});
