import fs from 'node:fs';
import {assessOriginalNative,profileManifest,headlessShellExecutable} from '../scripts/vite-react-native-profile.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {challengeDefinitions,challengePlan,parseChallengeArguments,mutateChallenge,assessChallengeNative,compareChallengePair,runChallenges} from '../scripts/vite-react-profile-challenges.js';
const project='/tmp/disposable-pinned-profile',A='playground/react-emotion/__tests__/react.spec.ts',B='playground/compiler/__tests__/compiler.spec.ts';
function report(rows){const files=[...new Set(rows.map(r=>r.file))];return {success:!rows.some(r=>r.status==='failed'),numTotalTests:rows.length,numPassedTests:rows.filter(r=>r.status==='passed').length,numFailedTests:rows.filter(r=>r.status==='failed').length,numPendingTests:rows.filter(r=>r.status!=='passed'&&r.status!=='failed').length,numRuntimeErrorTestSuites:0,numTotalTestSuites:files.length,numPassedTestSuites:files.filter(file=>!rows.some(r=>r.file===file&&r.status==='failed')).length,numFailedTestSuites:files.filter(file=>rows.some(r=>r.file===file&&r.status==='failed')).length,numPendingTestSuites:0,numTodoTests:0,testResults:files.map(file=>({name:project+'/'+file,status:rows.some(r=>r.file===file&&r.status==='failed')?'failed':'passed',message:'',assertionResults:rows.filter(r=>r.file===file).map(r=>({fullName:r.name,status:r.status,failureMessages:r.status==='failed'?['Constructed assertion failure']:[]}))}))};}
const rows=[{file:A,name:'assert original style',status:'passed'},{file:B,name:'assert original source',status:'passed'}];
function assessed(list,files=[A,B],baseline=null){return assessChallengeNative(report(list),project,files,baseline);}
test('default plan is advisory and fixes equal native worker settings without executing a profile',async()=>{const result=await runChallenges({run:false,cases:['style']});assert.equal(result.mode,'plan-only');assert.equal(result.routingAuthority,'none');assert.equal(result.promotionAllowed,false);assert.equal(result.configurationOverrides.maxWorkers,1);assert.equal(result.configurationOverrides.fullAndSubsetIdentical,true);assert.equal(result.configurationOverrides.originalConcurrencyUnchanged,false);assert.deepEqual(challengePlan().cases,challengeDefinitions.map(d=>d.name));});
test('CLI supports only explicit fixed cases and no arbitrary source or selector options',()=>{assert.throws(()=>parseChallengeArguments(['--run']),/completed fresh/);assert.throws(()=>parseChallengeArguments(['--cases','route,route']),/fixed named/);assert.throws(()=>parseChallengeArguments(['--cases','arbitrary']),/fixed named/);assert.throws(()=>parseChallengeArguments(['--patch','bad']),/Unknown/);assert.throws(()=>parseChallengeArguments(['--profile','relative']),/Absolute/);assert.deepEqual(parseChallengeArguments(['--profile','/tmp/private-profile','--cases','route,asset']).cases,['route','asset']);});
test('fixed fault replacement requires one exact location and asset mutation leaves every later byte unchanged',()=>{const definition=challengeDefinitions.find(d=>d.name==='source');assert.throws(()=>mutateChallenge(Buffer.from('not a target'),definition),/Unique/);assert.throws(()=>mutateChallenge(Buffer.from('count + 1; count + 1'),definition),/Unique/);assert.equal(mutateChallenge(Buffer.from('return count + 1'),definition).toString(),'return count + 2');const bytes=Buffer.from([0,1,2,3]),mutated=mutateChallenge(bytes,challengeDefinitions.find(d=>d.name==='asset'));assert.deepEqual(mutated,Buffer.from([1,1,2,3]));assert.deepEqual(bytes,Buffer.from([0,1,2,3]));});
test('independent full/subset exact failures qualify only the constructed fault, with no omission authority',()=>{const baseline=assessed(rows),fault=[{...rows[0],status:'failed'},rows[1]],full=assessed(fault,[A,B],rows),subset=assessed([fault[0]],[A],rows),pair=compareChallengePair(full,subset,baseline,[A]);assert.equal(pair.qualified,true);assert.equal(pair.failurePreserved,true);assert.equal(pair.automaticOmissionAuthority,false);});
test('a passing wrong route/reference cannot conceal a failed original full assertion',()=>{const baseline=assessed(rows),fault=[{...rows[0],status:'failed'},rows[1]],full=assessed(fault,[A,B],rows),wrong=assessed([fault[1]],[B],rows),negative=compareChallengePair(full,wrong,baseline,[B]);assert.equal(negative.qualified,false);assert.ok(negative.reasons.includes('Full-run failure omitted or missed'));const unknown=compareChallengePair(full,wrong,baseline,['playground/unknown/__tests__/unknown.spec.ts']);assert.equal(unknown.qualified,false);assert.ok(unknown.reasons.includes('Unknown or empty selection'));});
test('all-pending or zero full outcomes reject even with self-consistent native counts',()=>{const pending=rows.map(r=>({...r,status:'pending'}));assert.equal(assessed(pending).complete,false);assert.equal(assessed([],[]).complete,false);const baseline=assessed(rows),forged={complete:true,files:[A,B],rows:pending};assert.equal(compareChallengePair(forged,forged,baseline,[A,B]).qualified,false);});
test('missing, duplicated, escaped, shifted, runtime-error or newly pending identities reject',()=>{const duplicate=report([rows[0],rows[0]]);assert.equal(assessChallengeNative(duplicate,project,[A]).complete,false);const escaped=report(rows);escaped.testResults[0].name='/elsewhere/test.ts';assert.equal(assessChallengeNative(escaped,project,[A,B]).complete,false);const shifted=[{...rows[0],name:'different original assertion'},rows[1]];assert.equal(assessed(shifted,[A,B],rows).complete,false);const runtime=report(rows);runtime.numRuntimeErrorTestSuites=1;assert.equal(assessChallengeNative(runtime,project,[A,B]).complete,false);const newlyPending=[{...rows[0],status:'pending'},rows[1]];assert.equal(assessed(newlyPending,[A,B],rows).complete,false);assert.equal(assessed([rows[0]],[A,B],rows).complete,false);});
test('asset pass/pass is only a consistency negative and cannot qualify bug detection',()=>{const baseline=assessed(rows),subset=assessed([rows[0]],[A],rows);assert.equal(compareChallengePair(baseline,subset,baseline,[A],{requiresFailure:false}).qualified,true);assert.equal(compareChallengePair(baseline,subset,baseline,[A],{requiresFailure:false}).failurePreserved,false);assert.equal(compareChallengePair(baseline,subset,baseline,[A]).qualified,false);assert.equal(challengeDefinitions.find(d=>d.name==='asset').requiresFailure,false);});

test('pinned Playwright registry uses chrome-mac/linux headless_shell paths',()=>{assert.equal(headlessShellExecutable('/private/browser','1181','darwin'),'/private/browser/chromium_headless_shell-1181/chrome-mac/headless_shell');assert.equal(headlessShellExecutable('/private/browser','1181','linux'),'/private/browser/chromium_headless_shell-1181/chrome-linux/headless_shell');assert.throws(()=>headlessShellExecutable('/private/browser','1181','win32'),/supported/);});

const nativeSchema=JSON.parse(fs.readFileSync(new URL('./fixtures/vite-react-3.2.4-native-schema.json',import.meta.url)));
const schemaProject='/pinned/upstream',schemaFiles=nativeSchema.testResults.map(s=>s.name.slice(schemaProject.length+1));
test('actual pinned native schema without runtime-error count accepts exact original inventory',()=>{
 assert.equal(Object.hasOwn(nativeSchema,'numRuntimeErrorTestSuites'),false);
 const result=assessChallengeNative(nativeSchema,schemaProject,schemaFiles);
 assert.equal(result.complete,true);assert.deepEqual(result.counts,{passed:62,failed:0,pending:2,total:64});
 assert.equal(assessOriginalNative(nativeSchema,schemaProject,'serve').complete,true);
 assert.equal(result.rows.length,profileManifest().serveCases.length);
 const optional=structuredClone(nativeSchema);optional.numRuntimeErrorTestSuites=0;assert.equal(assessChallengeNative(optional,schemaProject,schemaFiles).complete,true);
 for(const invalid of [1,-1,null,'0']){optional.numRuntimeErrorTestSuites=invalid;assert.equal(assessChallengeNative(optional,schemaProject,schemaFiles).complete,false);}
});
test('afterAll suite errors reject even when every assertion passed and no runtime count is emitted',()=>{
 // Constructed controls use the original reporter fields. No new native hook run is claimed.
 for(const honestSuccess of [false,true]){const value=structuredClone(nativeSchema);value.testResults[0].status='failed';value.testResults[0].message='afterAll: recorder failed';value.numFailedTestSuites=1;value.numPassedTestSuites--;value.success=honestSuccess;
  assert.equal(value.numFailedTests,0);assert.equal(value.numPassedTests,62);
  assert.equal(assessChallengeNative(value,schemaProject,schemaFiles).complete,false);
  assert.equal(assessOriginalNative(value,schemaProject,'serve').complete,false);
 }
});
test('suite messages, missing status, incorrect counts and hidden assertion errors cannot pass',()=>{
 for(const alter of [v=>v.testResults[0].message='unhandled hook error',v=>delete v.testResults[0].status,v=>v.numTotalTestSuites++,v=>v.numFailedTestSuites++,v=>v.numPendingTestSuites=1,v=>v.numTodoTests=1,v=>delete v.numPassedTestSuites,v=>v.testResults[0].assertionResults[0].failureMessages=['hidden error']]){
  const value=structuredClone(nativeSchema);alter(value);assert.equal(assessChallengeNative(value,schemaProject,schemaFiles).complete,false);assert.equal(assessOriginalNative(value,schemaProject,'serve').complete,false);
 }
});

test('an exit-one process cannot hide an unrepresented runtime error behind an all-passed JSON report',()=>{
 assert.equal(assessChallengeNative(nativeSchema,schemaProject,schemaFiles,null,0).complete,true);
 assert.equal(assessChallengeNative(nativeSchema,schemaProject,schemaFiles,null,1).complete,false);
 const fault=report([{...rows[0],status:'failed'},rows[1]]);
 assert.equal(assessChallengeNative(fault,project,[A,B],null,1).complete,true);
 assert.equal(assessChallengeNative(fault,project,[A,B],null,0).complete,false);
});
