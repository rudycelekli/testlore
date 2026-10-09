import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayClaudeMemObservation} from '../scripts/claude-mem-frozen-replay.js';

test('frozen genuine Bun reports replay without turning rejected scopes into qualification',()=>{
 const result=replayClaudeMemObservation();
 assert.equal(result.verifiedMembers,56);assert.equal(result.completeNativeReports,9);
 assert.equal(result.baselineRows.filter(r=>r.baselineGreen).length,4);
 assert.equal(result.baselineRows.find(r=>r.report==='campaign/baseline-tests.json').complete,false);
 assert.equal(result.originalRouteFailures.length,5);
 assert.equal(result.diagnosticComparisons.length,3);
 for(const trial of result.diagnosticComparisons){assert.equal(trial.exactCaseStatusPreserved,true);assert.equal(trial.additionalHistoricalFault.length,1);assert.equal(trial.selectedFiles,trial.totalFiles);assert.ok(trial.testLoreMs>trial.nativeMs);}
 assert.equal(result.qualified,false);assert.ok(result.reasons.includes('dependency-inventory-rejected'));
});

test('frozen native replay rejects altered evidence and substituted index',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-claude-frozen-'));
 const original=fileURLToPath(new URL('../benchmarks/claude-mem-20261009/',import.meta.url));
 try{
  for(const file of ['native-diagnostics.integrity.json','native-diagnostics.json.gz'])fs.copyFileSync(path.join(original,file),path.join(directory,file));
  const archive=path.join(directory,'native-diagnostics.json.gz'),bytes=fs.readFileSync(archive);bytes[bytes.length-1]^=1;fs.writeFileSync(archive,bytes);
  assert.throws(()=>replayClaudeMemObservation(directory),/observation identity changed/);
  const index=path.join(directory,'native-diagnostics.integrity.json');fs.appendFileSync(index,' ');
  assert.throws(()=>replayClaudeMemObservation(directory),/integrity index changed/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
