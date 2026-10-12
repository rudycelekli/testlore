import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { qualifyBugRecipe,captureBugProbeSource } from '../src/bug-recipes.js';
import { investigateBugs } from '../src/bug-investigation.js';
import { repairInvestigation } from '../src/investigation-repair.js';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const git = (root,...args) => execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const requirements = 'encode must count Unicode code points. ASCII results remain unchanged. Preserve the existing native assertions and all other behavior.';
const original = 'export function encode(value){return value.length;}\n';
const fixed = 'export function encode(value){return Array.from(value).length;}\n';
const review = {accepted:true,findings:[],oracle:{independent:true,basis:[requirements]}};
const patch = content => ({files:[{path:'src/encode.mjs',content}],review});
async function fixture(t,configuration = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-proactive-repair-')),records=[];
  t.after(()=>{for(const result of records){for(const location of new Set([result.worktreeRoot,result.investigation?.outerWorktree])){if(!location)continue;try{git(root,'worktree','remove','--force',location);}catch{}fs.rmSync(location,{recursive:true,force:true});}if(result.branch){try{git(root,'branch','-D',result.branch);}catch{}}}fs.rmSync(root,{recursive:true,force:true});});
  const put=(file,content)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),typeof content==='string'?content:JSON.stringify(content));};
  put('package.json',{type:'module'});put('.gitignore','.tddswarm/\nnode_modules/\n');put('src/encode.mjs',original);put('src/unrelated.mjs','export const unchanged=1;\n');put('tddswarm.requirements.md',requirements);
  put('test/original.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';import {encode} from '../src/encode.mjs';test('original ASCII contract',()=>assert.equal(encode('hello'),5));\n");
  put('tddswarm.config.json',{adapter:'node',...configuration,repair:{...configuration.repair,challenges:'quality/challenges.json'}});
  put('quality/challenges.json',{schemaVersion:1,independent:true,basis:'Unchanged independent ASCII behavior contract.',cases:[{id:'preserved-ascii',script:'quality/ascii.cjs'}]});
  put('quality/ascii.cjs',"module.exports=async ({assert,root})=>{const {pathToFileURL}=require('url');const {encode}=await import(pathToFileURL(require('path').join(root,'src/encode.mjs')).href);assert.strictEqual(encode('hello'),5);};");
  put('contract.md','encode returns Unicode code point count and retains ASCII results.\n');
  put('.tddswarm/before/src/encode.mjs',original);put('.tddswarm/after/src/encode.mjs',fixed);
  const recipe={schemaVersion:1,kind:'bug-recipe',id:'unicode-length',family:'unicode-boundary',provenance:{repository:'https://github.com/example/constructed',baseRevision:'a'.repeat(40),fixedRevision:'b'.repeat(40),evidenceClass:'constructed'},contract:{text:'Count Unicode code points.',sourceUrl:'https://example.test/specification',sourceSha256:hash('independent specification'),independence:'independent-specification'},probe:{exportName:'encode',cases:[{id:'astral-count',args:['😀'],expect:{kind:'equals',value:1}},{id:'ascii-count',args:['hello'],expect:{kind:'equals',value:5}}]},applicability:{requiredIdentifiers:['encode']}};
  put('recipe.json',JSON.stringify(recipe));const recipeSha256=hash(fs.readFileSync(path.join(root,'recipe.json')));
  await qualifyBugRecipe({recipe,original:{root:path.join(root,'.tddswarm/before'),module:'src/encode.mjs',files:['src/encode.mjs']},fixed:{root:path.join(root,'.tddswarm/after'),module:'src/encode.mjs',files:['src/encode.mjs']},outputRoot:path.join(root,'.tddswarm/qualification')});
  const files=['src/encode.mjs','package.json'],manifest={schemaVersion:1,kind:'bug-investigation-manifest',recipes:[{path:'recipe.json',sha256:recipeSha256,qualification:{path:'.tddswarm/qualification/qualification.json',sha256:hash(fs.readFileSync(path.join(root,'.tddswarm/qualification/qualification.json')))}}],targets:[{id:'encode',module:'src/encode.mjs',files,tests:['test/original.test.mjs'],contracts:[{recipeId:recipe.id,recipeSha256,sourceSha256:captureBugProbeSource(root,{module:'src/encode.mjs',files}).sourceSha256,expectation:{path:'contract.md',sha256:hash(fs.readFileSync(path.join(root,'contract.md')))},reviewer:'independent-reviewer'}]}],budget:{totalMs:10000,timeoutMs:1000,maxInvestigations:3}};
  put('tddswarm.probes.json',manifest);
  git(root,'init','-b','main');git(root,'config','user.name','TestLore Test');git(root,'config','user.email','test@example.invalid');git(root,'add','.');git(root,'commit','-m','original green project');
  const report=await investigateBugs(root,{execute:true});assert.equal(report.findings[0].outcome,'reproduced');
  const options={report:report.receipt,reportSha256:hash(fs.readFileSync(path.join(root,report.receipt))),findingId:report.findings[0].id,deadlineMs:60000};
  return {root,report,options,records,put,head:git(root,'rev-parse','HEAD'),originalTest:fs.readFileSync(path.join(root,'test/original.test.mjs'))};
}

test('originally green project earns stable new assertion failure and isolated source repair without changing original tests',async t=>{
  const f=await fixture(t),result=await repairInvestigation(f.root,{...f.options,patch:patch(fixed)});f.records.push(result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.sourceHead,f.head);assert.equal(result.base,f.head);assert.equal(result.baseBranch,'main');
  assert.equal(result.investigation.originalGreenRuns.length,2);assert.equal(result.investigation.regressionFailureRuns.length,2);
  for(const run of result.investigation.originalGreenRuns){assert.equal(run.exitCode,0);assert.equal(run.complete,true);assert.equal(run.tests.length,1);}
  for(const run of result.investigation.regressionFailureRuns){assert.equal(run.exitCode,1);assert.equal(run.complete,true);assert.equal(run.tests.filter(item=>item.status==='failed').length,1);assert.equal(run.tests.length,3);}
  assert.equal(result.fullRun.tests.length,3);assert.ok(result.fullRun.tests.every(item=>item.status==='passed'));assert.equal(result.validation.accepted,true);
  assert.equal(result.investigation.originalAssertionsPreserved,true);assert.equal(result.investigation.newRegressionVerified,true);
  assert.deepEqual(fs.readFileSync(path.join(result.worktree,'test/original.test.mjs')),f.originalTest);assert.equal(fs.readFileSync(path.join(result.worktree,'tddswarm.requirements.md'),'utf8'),requirements);
  assert.equal(git(f.root,'rev-parse','HEAD'),f.head);assert.equal(git(f.root,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(f.root,'src/encode.mjs'),'utf8'),original);
  assert.deepEqual(git(result.worktree,'diff','--name-only',f.head,result.sha).split('\n').sort(),['src/encode.mjs',result.investigation.regressionTest].sort());
  assert.equal(result.published,false);assert.equal(result.merged,false);
});

test('wrong source fix is rejected by original and added native assertions',async t=>{
  const f=await fixture(t),result=await repairInvestigation(f.root,{...f.options,patch:patch('export function encode(){return 1;}\n')});f.records.push(result);
  assert.equal(result.status,'validation-rejected',JSON.stringify(result));assert.equal(result.sha,null);assert.equal(result.published,false);
  assert.equal(git(f.root,'rev-parse','HEAD'),f.head);assert.deepEqual(fs.readFileSync(path.join(f.root,'test/original.test.mjs')),f.originalTest);
});

test('deterministic real worker transport completes architect author reviewer and unchanged native validation',async t=>{
  const f=await fixture(t),worker=path.join(f.root,'.tddswarm/worker.cjs');
  fs.writeFileSync(worker,`let input='';process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>{const request=JSON.parse(input);console.log(JSON.stringify(request.role==='repair-architect'?{tasks:[{subject:'src/encode.mjs',instructions:'Restore independently required code point count.'}]}:request.role==='repair-author'?${JSON.stringify({files:[{path:'src/encode.mjs',content:fixed}]})}:${JSON.stringify(review)}));});`);
  const result=await repairInvestigation(f.root,{...f.options,agent:[process.execPath,worker]});f.records.push(result);
  assert.equal(result.status,'ready-for-review',JSON.stringify(result));assert.equal(result.workers.completedCalls,3);assert.equal(result.fullRun.exitCode,0);assert.equal(result.investigation.originalAssertionsPreserved,true);
});

test('stale report and dirty caller are refused before source workers',async t=>{
  const f=await fixture(t);f.put('contract.md','Different current intended behavior.\n');
  await assert.rejects(repairInvestigation(f.root,{...f.options,patch:patch(fixed)}),/Commit or stash|stale/);
  git(f.root,'add','contract.md');git(f.root,'commit','-m','new contract');
  await assert.rejects(repairInvestigation(f.root,{...f.options,patch:patch(fixed)}),/stale/);
});

test('source-only ownership rejects attempts to replace the original native oracle',async t=>{
  const f=await fixture(t),result=await repairInvestigation(f.root,{...f.options,patch:{files:[{path:'test/original.test.mjs',content:'// weakened oracle\n'}],review}});f.records.push(result);
  assert.equal(result.status,'failed');assert.match(result.error,/source|ownership|scope|file/i);assert.equal(result.sha,null);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'test/original.test.mjs')),f.originalTest);
});

test('original report drift during architect execution is rejected before an author is called',async t=>{
  const f=await fixture(t),worker=path.join(f.root,'.tddswarm/mutating-worker.cjs'),marker=path.join(f.root,'.tddswarm/worker-roles.txt');
  fs.writeFileSync(worker,`const fs=require('node:fs');let input='';process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>{const request=JSON.parse(input);fs.appendFileSync(${JSON.stringify(marker)},request.role+'\\n');if(request.role==='repair-architect')fs.appendFileSync(${JSON.stringify(path.join(f.root,f.options.report))},' ');console.log(JSON.stringify(request.role==='repair-architect'?{tasks:[{subject:'src/encode.mjs',instructions:'Restore required behavior.'}]}:${JSON.stringify({files:[{path:'src/encode.mjs',content:fixed}]})}));});`);
  const result=await repairInvestigation(f.root,{...f.options,agent:[process.execPath,worker]});f.records.push(result);
  assert.equal(result.status,'failed');assert.equal(result.published,false);assert.equal(result.sha,null);
  assert.equal(fs.readFileSync(marker,'utf8').trim(),'repair-architect');assert.equal(git(f.root,'rev-parse','HEAD'),f.head);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'test/original.test.mjs')),f.originalTest);
});

test('hash-bound but rewritten proposal cannot introduce an arbitrary regression oracle',async t=>{
  const f=await fixture(t),reportPath=path.join(f.root,f.options.report),report=JSON.parse(fs.readFileSync(reportPath)),proposalPath=path.join(f.root,report.findings[0].regressionProposal.path),proposal=JSON.parse(fs.readFileSync(proposalPath));
  proposal.files[0].content="import test from 'node:test';test('invented failure',()=>{throw new Error('manufactured')});\n";
  fs.writeFileSync(proposalPath,JSON.stringify(proposal));report.findings[0].regressionProposal.sha256=hash(fs.readFileSync(proposalPath));delete report.integrity;report.integrity=hash(report);fs.writeFileSync(reportPath,JSON.stringify(report));
  await assert.rejects(repairInvestigation(f.root,{...f.options,reportSha256:hash(fs.readFileSync(reportPath)),agent:['never-start-this']}),/Regression proposal differs/);
  assert.equal(git(f.root,'rev-parse','HEAD'),f.head);assert.equal(git(f.root,'status','--porcelain'),'');
});

test('unsupported framework profile abstains before starting agents',async t=>{
  const f=await fixture(t,{adapter:'vitest'}),result=await repairInvestigation(f.root,{...f.options,agent:['never-start-this']});
  assert.equal(result.status,'unsupported-investigation-repair');assert.equal(result.published,false);assert.equal(git(f.root,'status','--porcelain'),'');
});

test('reviewed target contract cannot override a narrower configured production repair scope',async t=>{
  const f=await fixture(t,{repair:{sourcePaths:['src/unrelated.mjs']}}),result=await repairInvestigation(f.root,{...f.options,agent:['never-start-this']});
  assert.equal(result.status,'awaiting-source-ownership');assert.equal(result.module,'src/encode.mjs');assert.equal(result.published,false);assert.equal(result.worktree,undefined);
  assert.equal(git(f.root,'rev-parse','HEAD'),f.head);assert.equal(git(f.root,'status','--porcelain'),'');assert.deepEqual(fs.readFileSync(path.join(f.root,'test/original.test.mjs')),f.originalTest);
});

test('deadline includes original full native phases and cannot approve incomplete evidence',async t=>{
  const f=await fixture(t),result=await repairInvestigation(f.root,{...f.options,deadlineMs:100,agent:['never-start-this']});f.records.push(result);
  assert.notEqual(result.status,'ready-for-review');assert.equal(result.sha,null);assert.equal(result.published,false);assert.equal(git(f.root,'rev-parse','HEAD'),f.head);
});
