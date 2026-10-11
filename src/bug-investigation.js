import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
import {safePath,readConfig,git} from './files.js';
import {parseAssessmentJSON} from './assessments.js';
import {readBugRecipe,captureBugProbeSource,verifyBugRecipeQualification,verifyBugProbeReceipt,executeBugProbe} from './bug-recipes.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=/^[a-f0-9]{64}$/;
const identifier=/^[A-Za-z_$][A-Za-z0-9_$]*$/;
const authority={routingOmissions:false,repairAcceptance:false,learningPromotion:false};
const requireThat=(condition,message)=>{if(!condition)throw new Error(message);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const relative=file=>typeof file==='string'&&file.length<=512&&file.length>0&&!file.includes('\\')&&!/[\x00-\x1f\x7f]/.test(file)&&!path.isAbsolute(file)&&!file.split('/').some(part=>['','.','..'].includes(part));

/** Hash-bound local inputs; neither a seal nor an approval field proves independent review. */
export function readInvestigationInput(root,file,{expectedSha256,maxBytes=4*1024*1024,json=true}={}){
 requireThat(relative(file),'Investigation requires an exact project-relative path');
 const location=safePath(root,file),named=fs.lstatSync(location);
 requireThat(named.isFile()&&named.size<=maxBytes,'Investigation input must be a bounded regular file');
 const fd=fs.openSync(location,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);requireThat(before.isFile()&&before.dev===named.dev&&before.ino===named.ino&&before.size<=maxBytes,'Investigation input changed while opening');
  const buffer=Buffer.alloc(before.size+1);let size=0;
  while(size<buffer.length){const count=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!count)break;size+=count;}
  const after=fs.fstatSync(fd),current=fs.lstatSync(safePath(root,file));
  requireThat(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&current.isFile()&&current.dev===before.dev&&current.ino===before.ino,'Investigation input changed during read');
  const bytes=buffer.subarray(0,size),sha256=sha(bytes);requireThat(expectedSha256===undefined||hash.test(expectedSha256)&&sha256===expectedSha256,'Investigation input hash mismatch');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {value:json?parseAssessmentJSON(text):text,sha256,bytes:size};
 }finally{fs.closeSync(fd);}
}

function seal(value){return {...value,integrity:sha(JSON.stringify(value))};}
function verifySeal(value){const {integrity,...body}=value;requireThat(hash.test(integrity)&&sha(JSON.stringify(body))===integrity,'Investigation receipt integrity mismatch');}
function validateManifest(value){
 requireThat(exact(value,['schemaVersion','kind','recipes','targets','budget'])&&value.schemaVersion===1&&value.kind==='bug-investigation-manifest','Invalid bug investigation manifest');
 requireThat(Array.isArray(value.recipes)&&value.recipes.length>0&&value.recipes.length<=32,'Investigation needs 1–32 recipe references');
 for(const reference of value.recipes){requireThat(exact(reference,['path','sha256','qualification'])&&relative(reference.path)&&hash.test(reference.sha256)&&exact(reference.qualification,['path','sha256'])&&relative(reference.qualification.path)&&hash.test(reference.qualification.sha256),'Recipe needs exact recipe and replay qualification byte references');}
 requireThat(new Set(value.recipes.map(item=>item.path)).size===value.recipes.length,'Duplicate recipe reference');
 requireThat(Array.isArray(value.targets)&&value.targets.length>0&&value.targets.length<=32,'Investigation needs 1–32 bounded targets');
 const ids=new Set();
 for(const target of value.targets){
  requireThat(exact(target,['id','module','files','tests','contracts'])&&typeof target.id==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(target.id)&&!ids.has(target.id),'Invalid or duplicate investigation target');ids.add(target.id);
  requireThat(relative(target.module)&&Array.isArray(target.files)&&target.files.length>0&&target.files.length<=128&&target.files.every(relative)&&new Set(target.files).size===target.files.length&&target.files.includes(target.module),'Target needs exact module and declared source closure');
  requireThat(Array.isArray(target.tests)&&target.tests.length<=128&&target.tests.every(relative)&&new Set(target.tests).size===target.tests.length,'Invalid associated test declarations');
  requireThat(Array.isArray(target.contracts)&&target.contracts.length<=32,'Invalid independent target contracts');
  const recipes=new Set();
  for(const contract of target.contracts){
   requireThat(exact(contract,['recipeId','recipeSha256','sourceSha256','expectation','reviewer','revisionPolicy'])&&typeof contract.recipeId==='string'&&!recipes.has(contract.recipeId)&&hash.test(contract.recipeSha256)&&hash.test(contract.sourceSha256)&&(contract.revisionPolicy===undefined||['pinned-source','follow-contract'].includes(contract.revisionPolicy))&&exact(contract.expectation,['path','sha256'])&&relative(contract.expectation.path)&&hash.test(contract.expectation.sha256)&&typeof contract.reviewer==='string'&&contract.reviewer.trim().length>0&&contract.reviewer.length<=200,'Invalid independent target contract approval');recipes.add(contract.recipeId);
  }
 }
 const budget=value.budget;
 requireThat(exact(budget,['totalMs','timeoutMs','maxInvestigations'])&&Number.isInteger(budget.totalMs)&&budget.totalMs>=100&&budget.totalMs<=120000&&Number.isInteger(budget.timeoutMs)&&budget.timeoutMs>=50&&budget.timeoutMs<=10000&&Number.isInteger(budget.maxInvestigations)&&budget.maxInvestigations>=1&&budget.maxInvestigations<=128,'Invalid bounded investigation budget');
 return value;
}

function sourceIdentifiers(text){const found=new Set(),ast=ts.createSourceFile('probe.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);function visit(node){if(ts.isIdentifier(node))found.add(node.text);ts.forEachChild(node,visit);}visit(ast);return found;}

/** Read-only discovery of applicable historical probes. No project/module execution. */
export function planBugInvestigation(root,{manifest='tddswarm.probes.json'}={}){
 root=fs.realpathSync(root);
 const captured=readInvestigationInput(root,manifest),definition=validateManifest(captured.value),bound=new Map([[manifest,captured.sha256]]),recipes=[];
 for(const reference of definition.recipes){
  const loaded=readBugRecipe(root,reference.path,reference.sha256);
  requireThat(loaded.sha256===reference.sha256,'Recipe bytes changed');
  const qualified=verifyBugRecipeQualification(root,reference.qualification.path,{expectedSha256:reference.qualification.sha256,recipeSha256:loaded.recipeSha256});
  requireThat(qualified.qualified===true,'Recipe lacks a complete repeated historical replay');
  requireThat(!recipes.some(item=>item.recipe.id===loaded.recipe.id),'Duplicate recipe identity');
  bound.set(reference.path,reference.sha256);bound.set(reference.qualification.path,reference.qualification.sha256);
  for(const member of qualified.bindings||[])bound.set(member.path,member.sha256);
  recipes.push({...loaded,reference,qualification:qualified});
 }
 const candidates=[];
 for(const target of definition.targets){
  const source=captureBugProbeSource(root,{module:target.module,files:target.files});
  for(const file of source.files)bound.set(file.path,file.sha256);
  for(const file of target.tests){const input=readInvestigationInput(root,file,{json:false,maxBytes:1024*1024});bound.set(file,input.sha256);}
  const moduleInput=readInvestigationInput(root,target.module,{json:false,maxBytes:1024*1024}),tokens=sourceIdentifiers(moduleInput.value);
  for(const loaded of recipes){
   const required=loaded.recipe.applicability.requiredIdentifiers;
   requireThat(Array.isArray(required)&&required.length<=32&&required.every(item=>identifier.test(item)),'Unsupported recipe applicability identifiers');
   const approval=target.contracts.find(item=>item.recipeId===loaded.recipe.id);
   let reason=null;
   if(required.some(item=>!tokens.has(item))&&approval?.revisionPolicy!=='follow-contract')reason='Required source identifiers are absent; no matching investigation pattern.';
   else if(!approval)reason='No independently reviewed target expectation; do not invent intended behavior.';
   else if(approval.recipeSha256!==loaded.recipeSha256||approval.revisionPolicy!=='follow-contract'&&approval.sourceSha256!==source.sourceSha256)reason='Target approval is stale for these recipe or source bytes.';
   if(approval){const expected=readInvestigationInput(root,approval.expectation.path,{expectedSha256:approval.expectation.sha256,json:false,maxBytes:16000});requireThat(expected.value.trim().length>0,'Target expectation is empty');bound.set(approval.expectation.path,expected.sha256);}
   candidates.push({targetId:target.id,recipeId:loaded.recipe.id,recipeSha256:loaded.recipeSha256,module:target.module,files:target.files,tests:target.tests,sourceSha256:source.sourceSha256,applicable:reason===null,reason,recipe:loaded.recipe});
   requireThat(candidates.length<=128,'Investigation supports at most 128 recipe/target hypotheses');
  }
 }
 const sourceBinding={files:[...bound].sort(([a],[b])=>a.localeCompare(b)).map(([file,sha256])=>({path:file,sha256}))};
 requireThat(sourceBinding.files.length<=512,'Investigation input inventory exceeds 512 files');
 assertFresh(root,sourceBinding);
 const result={schemaVersion:1,kind:'bug-investigation-plan',manifest,manifestSha256:captured.sha256,recipeCatalogSha256:sha(JSON.stringify(recipes.map(item=>({id:item.recipe.id,sha256:item.sha256})))),sourceBinding,candidates,budget:definition.budget,authority:{...authority},limitations:['Source identifier matching proposes hypotheses; it is not semantic equivalence or dependency completeness.','Target approval is a recorded declaration; independent review must establish its truth.','Recipe qualification covers repeated module probes, not complete upstream native suites.'],nextAction:candidates.some(item=>item.applicable)?'Run investigate --execute to challenge approved hypotheses in bounded disposable module copies.':'Review the missing or stale expectations; installation alone cannot establish intended behavior.'};
 requireThat(Buffer.byteLength(JSON.stringify(result))<=2*1024*1024,'Investigation plan exceeds 2 MiB; reduce the declared hypothesis scope');return result;
}

function assertFresh(root,binding){let bytes=0;for(const file of binding.files){const input=readInvestigationInput(root,file.path,{json:false,expectedSha256:file.sha256,maxBytes:4*1024*1024});bytes+=input.bytes;requireThat(bytes<=16*1024*1024,'Investigation input inventory exceeds 16 MiB');}}

/** Read and replay seals plus CURRENT input freshness; historical observations remain historical. */
export function readInvestigationReport(root,file,{expectedSha256}={}){
 const input=readInvestigationInput(root,file,{expectedSha256}),report=input.value;verifySeal(report);
 requireThat(exact(report,['schemaVersion','kind','id','manifestSha256','recipeCatalogSha256','sourceBinding','findings','budget','durationMs','summary','authority','limitations','nextAction','integrity'])&&report.schemaVersion===1&&report.kind==='bug-investigation'&&typeof report.id==='string'&&/^[a-f0-9-]{36}$/.test(report.id)&&hash.test(report.manifestSha256)&&hash.test(report.recipeCatalogSha256)&&Number.isFinite(report.durationMs)&&report.durationMs>=0,'Invalid investigation report');
 requireThat(exact(report.sourceBinding,['files'])&&Array.isArray(report.sourceBinding.files)&&report.sourceBinding.files.length<=512&&report.sourceBinding.files.every(row=>exact(row,['path','sha256'])&&relative(row.path)&&hash.test(row.sha256))&&new Set(report.sourceBinding.files.map(row=>row.path)).size===report.sourceBinding.files.length,'Invalid investigation source inventory');
 requireThat(Array.isArray(report.findings)&&report.findings.length<=128&&Array.isArray(report.limitations)&&report.limitations.length<=16&&report.limitations.every(item=>typeof item==='string'&&item.length<=4000)&&typeof report.nextAction==='string'&&report.nextAction.length<=4000,'Invalid investigation findings');
 const bound=new Set(report.sourceBinding.files.map(row=>row.path)),boundHashes=new Map(report.sourceBinding.files.map(row=>[row.path,row.sha256]));
 requireThat(report.sourceBinding.files.some(row=>row.sha256===report.manifestSha256),'Investigation manifest lacks exact retained source binding');
 const ids=new Set();
 for(const finding of report.findings){
  requireThat(exact(finding,['id','targetId','recipeId','recipeSha256','module','files','tests','sourceSha256','outcome','durationMs','probeReceipt','reason','regressionProposal','reproducer'])&&hash.test(finding.id)&&!ids.has(finding.id)&&typeof finding.recipeId==='string'&&finding.recipeId.length<=96&&hash.test(finding.recipeSha256)&&hash.test(finding.sourceSha256)&&relative(finding.module)&&Array.isArray(finding.files)&&finding.files.length<=128&&new Set(finding.files).size===finding.files.length&&finding.files.every(file=>relative(file)&&bound.has(file))&&finding.files.includes(finding.module)&&Array.isArray(finding.tests)&&finding.tests.length<=128&&new Set(finding.tests).size===finding.tests.length&&finding.tests.every(file=>relative(file)&&bound.has(file))&&['reproduced','passed','inconclusive','not-applicable','budget-exhausted'].includes(finding.outcome)&&Number.isFinite(finding.durationMs)&&finding.durationMs>=0,'Invalid investigation finding');ids.add(finding.id);
  if(['reproduced','passed','inconclusive'].includes(finding.outcome)){
   requireThat(exact(finding.probeReceipt,['path','sha256'])&&relative(finding.probeReceipt.path)&&hash.test(finding.probeReceipt.sha256),'Executed finding lacks raw probe evidence');
   const raw=readInvestigationInput(root,finding.probeReceipt.path,{expectedSha256:finding.probeReceipt.sha256}).value;verifySeal(raw);
   requireThat(raw.kind==='bug-probe-receipt'&&raw.recipeId===finding.recipeId&&raw.recipeSha256===finding.recipeSha256&&raw.module===finding.module&&raw.sourceSha256===finding.sourceSha256&&raw.outcome===finding.outcome&&raw.durationMs===finding.durationMs,'Finding contradicts raw probe evidence');
   requireThat(Array.isArray(raw.files)&&raw.files.length===finding.files.length&&raw.files.every(row=>finding.files.includes(row.path)&&boundHashes.get(row.path)===row.sha256),'Probe source closure differs from report source bindings');
   requireThat(raw.recipe&&sha(JSON.stringify(raw.recipe))===finding.recipeSha256,'Retained recipe evidence is unavailable or changed');verifyBugProbeReceipt(raw,raw.recipe);
   if(finding.reproducer){const row=raw.cases.find(item=>item.id===finding.reproducer.caseId&&item.status==='mismatch'),declared=raw.recipe.probe.cases.find(item=>item.id===finding.reproducer.caseId);requireThat(finding.outcome==='reproduced'&&row&&declared&&JSON.stringify(finding.reproducer.args)===JSON.stringify(declared.args)&&JSON.stringify(finding.reproducer.expected)===JSON.stringify(declared.expect)&&JSON.stringify(finding.reproducer.observed)===JSON.stringify(row.observed),'Minimal reproducer contradicts raw observation');}
  }
  if(finding.regressionProposal){requireThat(finding.outcome==='reproduced'&&exact(finding.regressionProposal,['path','sha256']),'Invalid regression proposal reference');readInvestigationInput(root,finding.regressionProposal.path,{expectedSha256:finding.regressionProposal.sha256});}
 }
 for(const outcome of ['reproduced','passed','inconclusive','not-applicable','budget-exhausted'])requireThat(report.summary[outcome]===report.findings.filter(item=>item.outcome===outcome).length,'Investigation summary contradicts named observations');
 requireThat(JSON.stringify(report.authority)===JSON.stringify(authority),'Investigation report attempts to grant authority');
 const reasons=[];try{assertFresh(root,report.sourceBinding);}catch{reasons.push('Current recipe, source, contract or associated test inputs differ from the retained report.');}
 return {report,sha256:input.sha256,stale:reasons.length>0,reasons};
}

export async function investigateBugs(root,{manifest='tddswarm.probes.json',execute=false,reuse=true,deadlineMs}={}){
 const started=performance.now(),plan=planBugInvestigation(root,{manifest});
 requireThat(deadlineMs===undefined||Number.isInteger(deadlineMs)&&deadlineMs>=100&&deadlineMs<=900000,'Invalid investigation pipeline deadline');
 if(deadlineMs!==undefined)plan.budget={...plan.budget,totalMs:Math.min(plan.budget.totalMs,deadlineMs)};
 if(!execute)return plan;
 if(reuse){
  try{
   const pointer=readInvestigationInput(root,'.tddswarm/investigations/last.json').value;
   const previous=readInvestigationReport(root,pointer.path,{expectedSha256:pointer.sha256});
   if(!previous.stale&&previous.report.manifestSha256===plan.manifestSha256&&previous.report.recipeCatalogSha256===plan.recipeCatalogSha256&&JSON.stringify(previous.report.sourceBinding)===JSON.stringify(plan.sourceBinding)&&previous.report.summary.inconclusive===0&&previous.report.summary['budget-exhausted']===0)return {...previous.report,receipt:pointer.path,reused:true,exitCode:previous.report.summary.reproduced?1:0};
  }catch{} // Corrupt/missing historical pointers cannot establish current evidence.
 }
 const {prioritizeBugRecipes}=await import('./investigation-outcomes.js');
 const ranked=readConfig(root).learning?.enabled===false?{selected:[]}:prioritizeBugRecipes(root,[...new Map(plan.candidates.filter(item=>item.applicable).map(item=>[item.recipeId,{id:item.recipeId,sha256:item.recipeSha256,family:item.recipe.family}])).values()],{remainingMs:plan.budget.totalMs,maxInvestigations:Math.min(100,plan.budget.maxInvestigations)});
 const order=new Map((ranked.selected||[]).map((row,index)=>[row.recipeId,index]));
 const candidates=[...plan.candidates].sort((a,b)=>(order.get(a.recipeId)??999)-(order.get(b.recipeId)??999));
 const id=randomUUID(),directory=`.tddswarm/investigations/${id}`,findings=[];fs.mkdirSync(safePath(root,directory),{recursive:true,mode:0o700});
 let count=0;
 for(const candidate of candidates){
  const {recipe,applicable,reason,...reference}=candidate,finding={id:sha(JSON.stringify({id,...reference})),...reference,outcome:'not-applicable',durationMs:0};
  if(!applicable)finding.reason=reason;
  else if(count>=plan.budget.maxInvestigations||performance.now()-started+100>=plan.budget.totalMs){finding.outcome='budget-exhausted';finding.reason='Bounded campaign stops before starting another probe.';}
  else{
   assertFresh(root,plan.sourceBinding);
   count++;const remaining=Math.floor(plan.budget.totalMs-(performance.now()-started));
   const observed=await executeBugProbe(root,{recipe,module:candidate.module,files:candidate.files,repeat:2,timeoutMs:Math.min(plan.budget.timeoutMs,Math.max(50,Math.floor(remaining/2)-25))});
   assertFresh(root,plan.sourceBinding);
   finding.outcome=['reproduced','passed'].includes(observed.outcome)?observed.outcome:'inconclusive';finding.durationMs=observed.durationMs??0;if(observed.reason==='deadline')finding.reason='probe-timeout';
   if(finding.outcome==='reproduced'){
    const mismatches=observed.cases.filter(item=>item.status==='mismatch').map(item=>{const declared=recipe.probe.cases.find(row=>row.id===item.id);return {caseId:item.id,args:declared.args,expected:declared.expect,observed:item.observed};}).sort((a,b)=>Buffer.byteLength(JSON.stringify(a.args))-Buffer.byteLength(JSON.stringify(b.args))||a.caseId.localeCompare(b.caseId));
    finding.reproducer={...mismatches[0],scope:'smallest-declared-failing-example; no global minimization established'};
   }
   const file=`${directory}/${finding.id}.probe.json`,bytes=JSON.stringify(observed,null,2)+'\n';fs.writeFileSync(safePath(root,file),bytes,{flag:'wx',mode:0o600});finding.probeReceipt={path:file,sha256:sha(bytes)};
   if(finding.outcome==='reproduced'){
    const proposal=regressionProposal(candidate);const file=`${directory}/${finding.id}.regression.json`,bytes=JSON.stringify(proposal,null,2)+'\n';fs.writeFileSync(safePath(root,file),bytes,{flag:'wx',mode:0o600});finding.regressionProposal={path:file,sha256:sha(bytes)};
   }
  }
  findings.push(finding);
 }
 assertFresh(root,plan.sourceBinding);
 const summary=Object.fromEntries(['reproduced','passed','inconclusive','not-applicable','budget-exhausted'].map(key=>[key,findings.filter(item=>item.outcome===key).length]));
 const body={schemaVersion:1,kind:'bug-investigation',id,manifestSha256:plan.manifestSha256,recipeCatalogSha256:plan.recipeCatalogSha256,sourceBinding:plan.sourceBinding,findings,budget:plan.budget,durationMs:performance.now()-started,summary,authority:{...authority},limitations:[...plan.limitations,'A reproduced probe contradicts the approved expectation in the declared module scope; full native verification and independent review are required before repair.','No model, provider or public submission was invoked. Investigation priority is advisory; learning improvement is unproven.'],nextAction:summary.reproduced?'Review the minimal reproducer and proposed regression. Validate against the genuine native suite before authorizing a source repair.':summary.inconclusive||summary['budget-exhausted']?'Inspect incomplete attempts and budget limits; no positive correctness claim is established.':'No approved probe contradicted its expectation in the observed scope. Review unexplored contracts rather than manufacturing a fix.'};
 const report=seal(body),file=`${directory}/report.json`,reportBytes=JSON.stringify(report,null,2)+'\n';requireThat(Buffer.byteLength(reportBytes)<=4*1024*1024,'Investigation report exceeds 4 MiB; raw attempts remain retained, reduce scope');fs.writeFileSync(safePath(root,file),reportBytes,{flag:'wx',mode:0o600});
 // Last-pointer content is only a byte reference; the immutable report remains the authority.
 fs.writeFileSync(safePath(root,'.tddswarm/investigations/last.json'),JSON.stringify({path:file,sha256:sha(fs.readFileSync(safePath(root,file)))})+'\n',{mode:0o600});
 return {...report,receipt:file,exitCode:summary.reproduced?1:summary.inconclusive||summary['budget-exhausted']?2:0};
}

export function buildInvestigationRegressionProposal(candidate){
 const file=`test/testlore-${candidate.recipeId.replace(/[^a-zA-Z0-9_-]/g,'-')}-${sha(candidate.module).slice(0,8)}.test.mjs`;
 const relativeModule=path.posix.relative(path.posix.dirname(file),candidate.module),specifier=relativeModule.startsWith('.')?relativeModule:'./'+relativeModule;
 const invocation=candidate.recipe.probe.exportName==='default'?'subject.default':`subject[${JSON.stringify(candidate.recipe.probe.exportName)}]`;
 const content=`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as subject from ${JSON.stringify(specifier)};\nconst cases=${JSON.stringify(candidate.recipe.probe.cases)};\nfor(const item of cases)test(item.id,async()=>{\n const call=()=>${invocation}(...item.args);\n if(item.expect.kind==='throws')await assert.rejects(async()=>await call(),{name:item.expect.name});\n else assert.deepEqual(await call(),item.expect.value);\n});\n`;
 return {schemaVersion:1,kind:'bug-regression-proposal',recipeId:candidate.recipeId,recipeSha256:candidate.recipeSha256,sourceSha256:candidate.sourceSha256,files:[{path:file,content}],authority:{apply:false,repairAcceptance:false},nextAction:'Review this new regression, confirm maintainer intent and native compatibility, then stage it using the existing reviewed patch workflow.'};
}
const regressionProposal=buildInvestigationRegressionProposal;

/** A lightweight installed status. Does not execute a runner or module. */
export function inspectInvestigationStatus(root){
 const pointer='.tddswarm/investigations/last.json';
 if(!fs.existsSync(safePath(root,pointer)))return {kind:'bug-investigation-status',status:'awaiting-probes',authority:{...authority},nextAction:'Create reviewed tddswarm.probes.json and run investigate; install investigation workflow hooks for trusted change events.'};
 const reference=readInvestigationInput(root,pointer).value;requireThat(exact(reference,['path','sha256'])&&relative(reference.path)&&hash.test(reference.sha256),'Invalid last investigation pointer');
 const captured=readInvestigationReport(root,reference.path,{expectedSha256:reference.sha256});
 return {kind:'bug-investigation-status',status:captured.stale?'stale':captured.report.summary.reproduced?'reproduced':'observed',report:reference,summary:captured.report.summary,stale:captured.stale,reasons:captured.reasons,nextAction:captured.stale?'Source or contracts changed; run a fresh investigation.':captured.report.nextAction,authority:{...authority}};
}

/** Visible health loop; no service, timers or provider calls are started. */
export async function immunityStatus(root,{manifest='tddswarm.probes.json',execute=false}={}){
 if(execute)return investigateBugs(root,{manifest,execute:true});
 const status=inspectInvestigationStatus(root),config=readConfig(root);
 const {listBundledBugRecipes}=await import('./bug-catalog.js');const catalog=listBundledBugRecipes();
 const {inspectInvestigationLearning}=await import('./investigation-outcomes.js');
 let plan=null,reason=null;
 try{plan=planBugInvestigation(root,{manifest});}catch(error){reason=String(error.message).slice(0,2000);}
 return {schemaVersion:1,kind:'repository-immunity',status:plan?status.status:'awaiting-reviewed-probes',observation:status,catalog,coverage:plan?{declaredTargets:new Set(plan.candidates.map(item=>item.targetId)).size,approvedInvestigations:plan.candidates.filter(item=>item.applicable).length,unresolvedInvestigations:plan.candidates.filter(item=>!item.applicable).length,universalCoverage:false}:null,learning:config.learning?.enabled===false?{enabled:false}:inspectInvestigationLearning(root),reason,backgroundServiceRunning:false,workflowInstalled:fs.existsSync(safePath(root,'.github/workflows/testlore-investigate.yml')),authority:{...authority},nextAction:plan?plan.nextAction:'Copy the historical probe catalog with probe-catalog --execute, then review independent target expectations. Installation alone does not activate investigation or guarantee findings.'};
}

/** Explicit install hook. Trusted default-branch changes only; no privileged fork execution. */
export function installInvestigationWorkflow(root,{actionRef,defaultBranch='main',manifest='tddswarm.probes.json'}={}){
 requireThat(/^[a-f0-9]{40}$/.test(actionRef),'Investigation workflow requires an exact reviewed --action-ref SHA');
 requireThat(/^[A-Za-z0-9._/-]+$/.test(defaultBranch)&&!defaultBranch.includes('..')&&!defaultBranch.startsWith('-'),'Invalid default branch');
 requireThat(fs.realpathSync(git(root,['rev-parse','--show-toplevel']).trim())===fs.realpathSync(root),'Investigation workflow requires repository root');
 const plan=planBugInvestigation(root,{manifest});
 const tracked=new Set(git(root,['ls-files','-z']).split('\0').filter(Boolean));
 requireThat(plan.sourceBinding.files.every(file=>tracked.has(file.path)),'Commit reviewed recipes, qualification evidence, target expectations and source before installing an investigation workflow');
 const file='.github/workflows/testlore-investigate.yml',target=safePath(root,file);if(fs.existsSync(target))return [];
 requireThat(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(manifest),'Workflow manifest path must use portable letters, numbers, dots, hyphens and slashes');
 const command=`npm exec --yes --package=github:rudycelekli/testlore#${actionRef} -- testlore investigate --manifest '${manifest}' --execute --json`;
 const text=`# Review and commit to activate; no daemon or schedule was started by setup.\nname: TestLore repository immunity\non:\n  push:\n    branches: [${JSON.stringify(defaultBranch)}]\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:\n  group: testlore-investigate-\${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  investigate:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n      - name: Challenge reviewed bug probes\n        run: ${command}\n      - name: Preserve findings and incomplete attempts\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: testlore-investigation-\${{ github.sha }}\n          path: .tddswarm/investigations\n          include-hidden-files: true\n          if-no-files-found: warn\n`;
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text,{flag:'wx'});return [file];
}
