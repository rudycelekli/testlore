import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {fixture,commit,twoModules} from './helpers.js';import {digest} from '../src/provenance.js';
import {freezePublicCandidates,validateCandidates,preparePublicCandidate,publicAttemptSummary,executePreparedPublic} from '../scripts/public-corpus.js';
const sha=n=>String(n).repeat(40),git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
function candidate(extra={}){return {id:'external-example',repository:'https://github.com/external/example',fixRevision:sha('a'),parentRevision:sha('b'),treeRevision:sha('c'),changedFiles:[{path:'src/a.js',status:'modified',headGitBlob:sha('d'),patchSha256:'1'.repeat(64)},{path:'test/a.test.js',status:'modified',headGitBlob:sha('e'),patchSha256:'2'.repeat(64)}],sourcePaths:['src/a.js'],maintainerOraclePaths:['test/a.test.js'],kind:'public-bugfix-inversion-candidate',status:'unmeasured',blockers:[],...extra};}
const freeze=c=>freezePublicCandidates({candidates:[c],accounting:[{scope:'Constructed controller test; not public evidence'}]});
test('preregistration rejects duplicate histories, identical patches, changed selections and fabricated qualification',()=>{
 const c=candidate(),selection=freeze(c);assert.equal(validateCandidates(selection),selection);assert.equal(selection.qualifiedChanges,0);
 assert.throws(()=>freezePublicCandidates({candidates:[c,c],accounting:[]}),/duplicate/);
 assert.throws(()=>freezePublicCandidates({candidates:[c,{...c,id:'external-other',fixRevision:sha('f')}],accounting:[]}),/identical change/);
 const altered=structuredClone(selection);altered.candidates[0].parentRevision=sha('f');assert.throws(()=>validateCandidates(altered),/commitment/);
 const rows=[{candidateId:c.id,status:'completed',assessment:{qualified:true}}];const result=publicAttemptSummary(selection,rows);assert.equal(result.qualified,0);assert.equal(result.targetMet,false);
 assert.throws(()=>publicAttemptSummary(selection,[...rows,...rows]),/one retained/);
 assert.throws(()=>freeze({...c,sourcePaths:['../src/a.js']}),/Source\/oracle/);
});
test('prepared upstream inversion reuses native corpus, preserves actual failures and rejects source/runtime/dependency drift',t=>{
 const source=fixture(t,{...twoModules,'package.json':'{"type":"module"}'});fs.writeFileSync(path.join(source,'src/a.js'),'export const a = 9;');commit(source);const parent=git(source,'rev-parse','HEAD');
 fs.writeFileSync(path.join(source,'src/a.js'),'export const a = 1;');commit(source);const head=git(source,'rev-parse','HEAD');git(source,'remote','add','origin','https://github.com/external/example.git');
 const c=candidate({fixRevision:head,parentRevision:parent,treeRevision:git(source,'rev-parse','HEAD^{tree}'),byteBindings:[{kind:'fixed-source',path:'src/a.js',gitBlob:sha('d'),bytes:19,sha256:digest('export const a = 1;')},{kind:'prior-source',path:'src/a.js',gitBlob:sha('e'),bytes:19,sha256:digest('export const a = 9;')}]});
 const selection=freeze(c),profile={reviewed:true,candidateId:c.id,root:source,scope:'Constructed two-case controller verification; no external independence claim',config:{adapter:'node',discovery:'native'},expectedFailureNames:['a']};
 const prepared=preparePublicCandidate(selection,c.id,profile);assert.equal(prepared.qualified,false);assert.equal(prepared.corpus.labels[0].origin.fixedSourceHash,digest('export const a = 1;'));
 assert.throws(()=>preparePublicCandidate(selection,c.id,{...profile,reviewed:false}),/reviewed/);
 assert.throws(()=>preparePublicCandidate(selection,c.id,{...profile,executionMode:'unified-native'}),/Vitest adapter/);
 assert.throws(()=>preparePublicCandidate(selection,c.id,{...profile,executionMode:'made-up'}),/reviewed/);
 const changed=structuredClone(prepared);changed.corpus.pilot.projects[0].changes[0].after='export const a = 2;';assert.throws(()=>executePreparedPublic(source,selection,changed,'.tddswarm/pilots/tampered'),/commitment/);
 const root=fixture(t,{}),attempt=executePreparedPublic(root,selection,prepared,'.tddswarm/pilots/actual');assert.equal(attempt.assessment.qualified,true,JSON.stringify(attempt));assert.equal(attempt.assessment.preservedFaultTrials,2);assert.equal(git(source,'rev-parse','HEAD'),head);assert.equal(git(source,'status','--porcelain'),'');
 assert.equal(publicAttemptSummary(selection,[attempt]).qualified,1);assert.equal(publicAttemptSummary(selection,[attempt]).targetMet,false);
 assert.ok(fs.existsSync(path.join(root,'.tddswarm/pilots/actual/public-attempt.json')));assert.throws(()=>executePreparedPublic(root,selection,prepared,'.tddswarm/pilots/actual'),/exist/i);
 fs.writeFileSync(path.join(source,'package.json'),'{"type":"module","changed":true}');assert.throws(()=>executePreparedPublic(root,selection,prepared,'.tddswarm/pilots/drift'),/Dependency identity/);
});
test('blocked candidates and partial attempts stay visible without counting repetitions as unique changes',()=>{
 const c=candidate({blockers:['browser-build-unqualified']}),selection=freeze(c);const result=publicAttemptSummary(selection,[{candidateId:c.id,status:'blocked',reason:'browser-build-unqualified'}]);assert.equal(result.blocked,1);assert.equal(result.selectedUniqueChanges,1);assert.equal(result.qualified,0);assert.equal(result.unattempted,0);
 const partial=publicAttemptSummary(selection,[{candidateId:c.id,status:'partial',assessment:{qualified:false,completedTrials:1}}]);assert.equal(partial.partial,1);assert.equal(partial.qualified,0);
});
