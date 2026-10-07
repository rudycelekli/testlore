import test from 'node:test';import assert from 'node:assert/strict';
import {assessCLIArms,captureCLI,exportUnifiedCLIProof} from '../scripts/unified-native-proof.js';
const a={id:'a'.repeat(64),file:'test/landing.test.js',name:'specified heading',status:'failed'},b={id:'b'.repeat(64),file:'test/pricing.test.js',name:'specified pricing',status:'passed'};
const run=(tests,files)=>({complete:true,exitCode:tests.some(test=>test.status==='failed')?1:0,tests:structuredClone(tests),executedFiles:files,outerMs:500});
function outcomes(){return {full:run([a,b],[a.file,b.file]),native:run([a],[a.file]),legacy:run([a],[a.file]),unified:{...run([a],[a.file]),unifiedNative:{used:true,contexts:1,fresh:true}}};}
const expectations={expectedFailureNames:[a.name],oracleFiles:[a.file]};
test('a faster selector that misses a demonstrated assertion cannot earn a speed comparison',()=>{
 const values=outcomes();values.native=run([],[]);values.native.outerMs=1;const assessment=assessCLIArms(values,expectations);assert.equal(assessment.qualified,true);assert.equal(assessment.arms.native.complete,true);assert.equal(assessment.arms.native.casePreservation,true);assert.equal(assessment.arms.native.missedFailures,1);assert.equal(assessment.nativeSpeedComparisonEligible,false);assert.equal(assessment.arms.native.qualityEquivalent,false);
 const missed=outcomes();missed.unified= {...run([b],[b.file]),unifiedNative:{used:true,contexts:1,fresh:true}};assert.equal(assessCLIArms(missed,expectations).qualified,false);
});
test('unchanged in-scope cases, full oracle identities and actual unified execution are qualification requirements',()=>{
 assert.equal(assessCLIArms(outcomes(),expectations).qualified,true);
 const missing=outcomes();missing.unified= {...missing.unified,tests:[{...a,name:'different assertion',id:'replacement'}]};assert.equal(assessCLIArms(missing,expectations).qualified,false);
 const altered=outcomes();altered.legacy.tests=[{...a,status:'passed'}];assert.equal(assessCLIArms(altered,expectations).qualified,false);
 const fake=outcomes();fake.unified.unifiedNative={used:false,contexts:1,fresh:true};assert.equal(assessCLIArms(fake,expectations).qualified,false);
 const old=outcomes();old.unified.unifiedNative.fresh=false;assert.equal(assessCLIArms(old,expectations).qualified,false);
 const duplicate=outcomes();duplicate.full.tests=[a,a];assert.equal(assessCLIArms(duplicate,expectations).demonstrated,false);
 const identity=outcomes();delete identity.unified.tests[0].id;assert.equal(assessCLIArms(identity,expectations).qualified,false);
 const incomplete=outcomes();incomplete.full.complete=false;assert.equal(assessCLIArms(incomplete,expectations).demonstrated,false);
 const wrongLabel={expectedFailureNames:['unobserved bug'],oracleFiles:[a.file]};assert.equal(assessCLIArms(outcomes(),wrongLabel).qualified,false);
 const moduleLoad=outcomes();moduleLoad.full.tests=[{...a,name:'<file-load>'}];assert.equal(assessCLIArms(moduleLoad,expectations).qualified,false);
});
test('native process capture retains output-budget and deadline failures instead of successful-looking partial results',async()=>{
 const large=await captureCLI([process.execPath,'-e','process.stdout.write("x".repeat(4096))'],{cwd:process.cwd(),timeoutMs:5000,maxBytes:128});assert.equal(large.completeTransport,false);assert.equal(large.outputTruncated,true);assert.equal(large.error,'output-budget-exceeded');assert.equal(Buffer.byteLength(large.stdout),128);
 const timeout=await captureCLI([process.execPath,'-e','setInterval(()=>{},1000)'],{cwd:process.cwd(),timeoutMs:150,maxBytes:128});assert.equal(timeout.completeTransport,false);assert.equal(timeout.error,'deadline-exceeded');assert.ok(timeout.outerMs>=150);assert.ok(timeout.outerMs<5000);
});
test('public proof export keeps rejected attempt counts and excludes raw commands, logs and case identities',()=>{
 const assessment=assessCLIArms(outcomes(),expectations),report={schemaVersion:1,kind:'four-arm-whole-cli-proof',complete:false,qualified:false,requestedScenarios:2,repetitions:2,attempts:[{complete:true,command:'/private/cwd',stdout:'private log'},{complete:false}],scenarios:[{origin:'constructed-independent-assertions',qualified:true,repetitions:[{repetition:0,order:['full','native','legacy','unified'],assessment}]}],controllerElapsedMs:1000,limitations:['Bounded constructed controller test only']};const result=exportUnifiedCLIProof(report);assert.equal(result.requestedAttempts,16);assert.equal(result.completedAttempts,1);assert.equal(result.uncompletedAttempts,15);assert.equal(result.qualified,false);assert.equal(result.qualifiedPublicBugfixes,0);const text=JSON.stringify(result);assert.equal(text.includes('/private/cwd'),false);assert.equal(text.includes('private log'),false);assert.equal(text.includes('specified heading'),false);assert.equal(text.includes('a'.repeat(64)),false);
});
