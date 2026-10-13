import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import {fixture,write,commit} from './helpers.js';
import {stageRepair,validateRepair,applyRepair,verifyAppliedRepairValidation} from '../src/repair-candidates.js';
const here=path.dirname(fileURLToPath(import.meta.url)),sdk=[path.join(here,'../node_modules/typescript'),path.join(here,'../../../../node_modules/typescript')].find(directory=>fs.existsSync(path.join(directory,'lib/typescript.js')));
const requirements='Addition returns the arithmetic sum. Preserve the independent retained value contract.';
const baseline='/** @param {number} a @param {number} b @returns {number} */ export const add=(a,b)=>a-b;\n';
const good=baseline.replace('a-b','a+b');
const bad=good+'/** @type {string} */ const hiddenTypeDefect=42;\n';
const review={accepted:true,findings:[],oracle:{independent:true,basis:[requirements]}};
function project(t,{enabled=true,config={},source=baseline}={}){
 assert.ok(sdk,'Actual installed TypeScript SDK required');
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'node_modules/\n.tddswarm/\n','tddswarm.config.json':{runner:[process.execPath,'--test','{files}'],plugins:{typescript:{enabled,timeoutMs:10000}},repair:{challenges:'quality/challenges.json'},...config},'tddswarm.requirements.md':requirements,'src/add.js':source,
  'tsconfig.json':{compilerOptions:{strict:true,allowJs:true,checkJs:true,skipLibCheck:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext'},files:['src/add.js']},
  'test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/add.js';test('arithmetic sum',()=>assert.equal(add(2,3),5));test('zero identity',()=>assert.equal(add(2,0),2));",
  'quality/challenges.json':{schemaVersion:1,independent:true,basis:'Maintainer authored arithmetic identity remains valid beyond original assertions.',cases:[{id:'retained-identity',script:'quality/retained.cjs'}]},
  'quality/retained.cjs':"module.exports=async ({assert,root})=>{const {add}=await import(require('url').pathToFileURL(root+'/src/add.js').href);assert.strictEqual(add(7,0),7);};"});
 fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(sdk,path.join(root,'node_modules/typescript'),{recursive:true});commit(root);return root;
}
const stage=(root,content=good)=>stageRepair(root,{files:[{path:'src/add.js',content}],sourcePaths:['src/add.js'],requirements,review});
const validate=(root,item)=>validateRepair(root,item.candidatePath,{timeoutMs:10000,totalTimeoutMs:90000});
function rewriteReceipt(root,item,mutate,{authenticated=false}={}){const file=path.join(item.directory,'validation.json'),value=JSON.parse(fs.readFileSync(file));mutate(value);if(authenticated){delete value.integrity;value.integrity=createHmac('sha256',fs.readFileSync(path.join(root,'.tddswarm/repair-validation.key'))).update(JSON.stringify(value)).digest('hex');}fs.writeFileSync(file,JSON.stringify(value));}

test('unchanged runtime assertions can all pass yet genuine TS2322 vetoes candidate repair',t=>{
 const root=project(t),item=stage(root,bad),result=validate(root,item);
 assert.equal(result.candidateRuns[0].exitCode,0);assert.equal(result.accepted,false);assert.equal(result.typecheck.baseline.length,2);assert.equal(result.typecheck.baseline[0].exitCode,0);assert.equal(result.typecheck.candidate[0].exitCode,1);assert.ok(result.typecheck.candidate[0].diagnostics.some(row=>row.code===2322));assert.match(result.reasons.join(','),/candidate-TypeScript-not-complete-green/);assert.throws(()=>applyRepair(root,item.candidatePath),/Accepted intact/);assert.equal(fs.readFileSync(path.join(root,'src/add.js'),'utf8'),baseline);
});

test('correct typed source repair passes repeated native/compiler/challenge evidence and authenticated publication admission',t=>{
 const root=project(t),item=stage(root),result=validate(root,item);assert.equal(result.accepted,true,result.reasons.join(','));assert.equal(result.typecheck.accepted,true);assert.equal(result.typecheck.baseline.length,2);assert.equal(result.typecheck.candidate.length,2);assert.ok(result.typecheck.candidate.every(run=>run.complete&&run.exitCode===0&&run.implementationFiles.includes('src/add.js')));assert.equal(applyRepair(root,item.candidatePath).applied,true);assert.equal(verifyAppliedRepairValidation(root,item.candidatePath).receipt.typecheck.accepted,true);
 const original=fs.readFileSync(path.join(item.directory,'validation.json'));rewriteReceipt(root,item,value=>{value.typecheck.candidate[0].implementationFiles=[];});assert.throws(()=>verifyAppliedRepairValidation(root,item.candidatePath),/Authenticated accepted/);fs.writeFileSync(path.join(item.directory,'validation.json'),original);
 rewriteReceipt(root,item,value=>{for(const run of [...value.typecheck.baseline,...value.typecheck.candidate])run.compiler.sha256='0'.repeat(64);},{authenticated:true});assert.throws(()=>verifyAppliedRepairValidation(root,item.candidatePath),/current compiler|inventory/);fs.writeFileSync(path.join(item.directory,'validation.json'),original);
 // Evaluator control: even a body re-authenticated by the test owner cannot turn
 // missing typed evidence into admissible legacy publication.
 rewriteReceipt(root,item,value=>{delete value.typecheck;},{authenticated:true});assert.throws(()=>verifyAppliedRepairValidation(root,item.candidatePath),/TypeScript repair validation/);fs.writeFileSync(path.join(item.directory,'validation.json'),original);
});

test('authenticated legacy or fabricated typed admission is refused at apply while disabled remains inert',t=>{
 const root=project(t),item=stage(root),result=validate(root,item);assert.equal(result.accepted,true,result.reasons.join(','));const original=fs.readFileSync(path.join(item.directory,'validation.json'));
 rewriteReceipt(root,item,value=>{for(const run of [...value.typecheck.baseline,...value.typecheck.candidate])run.compiler.sha256='0'.repeat(64);},{authenticated:true});assert.throws(()=>applyRepair(root,item.candidatePath),/current compiler|inventory/);fs.writeFileSync(path.join(item.directory,'validation.json'),original);
 rewriteReceipt(root,item,value=>{delete value.typecheck;},{authenticated:true});assert.throws(()=>applyRepair(root,item.candidatePath),/TypeScript repair validation/);fs.writeFileSync(path.join(item.directory,'validation.json'),original);
 rewriteReceipt(root,item,value=>{value.typecheck.candidate[0].complete=false;},{authenticated:true});assert.throws(()=>applyRepair(root,item.candidatePath),/TypeScript repair validation/);
 const disabled=project(t,{enabled:false}),untypedItem=stage(disabled,bad),untyped=validate(disabled,untypedItem);assert.equal(untyped.accepted,true,untyped.reasons.join(','));assert.equal(untyped.typecheck,undefined);assert.equal(applyRepair(disabled,untypedItem.candidatePath).applied,true);
});

test('missing SDK, noCheck and absolute installed links conservatively reject typed repairs',t=>{
 for(const kind of ['missing','noCheck','link']){const root=project(t);if(kind==='missing')fs.rmSync(path.join(root,'node_modules'),{recursive:true});if(kind==='noCheck')write(root,'tsconfig.json',{compilerOptions:{allowJs:true,checkJs:true,noCheck:true},files:['src/add.js']});if(kind==='link')fs.symlinkSync(path.join(root,'node_modules/typescript/lib/typescript.js'),path.join(root,'node_modules/absolute-sdk-link.js'));const item=stage(root),result=validate(root,item);assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/TypeScript|typed-repair/);assert.throws(()=>applyRepair(root,item.candidatePath));}
});

test('repeatable baseline type errors are retained while corrected typed candidates must be green',t=>{
 const root=project(t,{source:baseline.replace('@returns {number}','@returns {string}')}),item=stage(root),result=validate(root,item);assert.equal(result.accepted,true,result.reasons.join(','));assert.ok(result.typecheck.baseline.every(run=>run.complete&&run.exitCode===1&&run.diagnostics.some(row=>row.code===2322)));assert.ok(result.typecheck.candidate.every(run=>run.complete&&run.exitCode===0));assert.equal(applyRepair(root,item.candidatePath).applied,true);assert.equal(verifyAppliedRepairValidation(root,item.candidatePath).receipt.typecheck.accepted,true);
});
