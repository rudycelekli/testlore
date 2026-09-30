import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readConfig,validateConfig,safePath,TEST,listFiles} from './files.js';
import {snapshot,freshness,digest} from './provenance.js';
import {adapterFor,discover,execute} from './execution.js';
import {plan} from './selector.js';
import {compareSubsetCases} from './runner.js';
import {validateBrowserBuildArtifacts} from './browser-evidence.js';

const MAX_FILES=10000,MAX_BYTES=128*1024*1024,MAX_FILE_BYTES=8*1024*1024,MAX_CASES=2000;
const LIMITATIONS=[
  'Independent native full/subset runs qualify only this source snapshot and explicit change scenario; passing observations do not establish complete dependencies.',
  'Disposable source copies share trusted installed dependencies and external services. This is configuration isolation, not a security sandbox.',
  'Browser closed-world selection is evaluated only as a review hypothesis. This report never enables mappings or authorizes closed-world omission.'
];
function paths(root,values,label,max=1000){
  if(!Array.isArray(values)||!values.length||values.length>max||new Set(values).size!==values.length)throw new Error(`${label} must contain 1–${max} unique project paths`);
  for(const file of values){safePath(root,file);if(file.split('/').some(part=>!part||['.','node_modules','.git','.tddswarm'].includes(part)))throw new Error(`Invalid ${label} path`);}
  return values;
}
function proposalPatch(root,proposal,config,current){
  if(!proposal||proposal.schemaVersion!==1||!proposal.provenance)throw new Error('Mapping qualification requires a provenance-bound proposal');
  const check=freshness(proposal.provenance,current);if(!check.fresh)throw new Error(`Mapping proposal is stale: ${check.reasons.join(', ')}`);
  const warnings=[];let patch;
  function mappedPaths(values,label){paths(root,values,label);for(const file of values)if(!Object.hasOwn(current.files,file))throw new Error('Mapping declaration is outside copied source scope');}
  if(proposal.type==='browser-mapping-proposal'){
    const {integrity,...payload}=proposal;
    if(integrity!==digest(payload)||proposal.configurationHash!==digest(config)||proposal.reviewRequired!==true||proposal.closedWorld!==false)throw new Error('Invalid browser mapping proposal integrity or authority');
    if(!Array.isArray(proposal.caseMappings)||proposal.caseMappings.length>MAX_CASES||!Array.isArray(proposal.warnings)||proposal.warnings.length>4000)throw new Error('Invalid browser mapping proposal schema');
    warnings.push(...proposal.warnings);if(!proposal.observationsComplete)warnings.push('browser-observations-incomplete');
    if(proposal.caseMappings.some(mapping=>!Array.isArray(mapping.unresolved)||mapping.unresolved.length))warnings.push('browser-input-mappings-incomplete');
    if(proposal.buildManifest){validateBrowserBuildArtifacts(root,proposal.buildManifest);warnings.push('unverified-build-completeness');}
    patch=proposal.proposed;
    if(!patch||Object.keys(patch).some(key=>key!=='browser')||Object.keys(patch.browser||{}).some(key=>key!=='routes'))throw new Error('Proposal may only add browser route declarations');
    for(const [route,declaration]of Object.entries(patch.browser?.routes||{})){
      if(!route.startsWith('/')||route.includes('?')||route.includes('#')||Object.hasOwn(config.browser?.routes||{},route))throw new Error('Proposal cannot replace manual browser routes');
      if(!declaration||Object.keys(declaration).some(key=>!['tests','inputs'].includes(key)))throw new Error('Invalid proposed browser route');
      mappedPaths(declaration.tests,'route tests');mappedPaths(declaration.inputs,'route inputs');
    }
  }else{
    if(proposal.applied!==false||proposal.stable!==true||!Array.isArray(proposal.proposals)||!proposal.proposals.length||proposal.proposals.length>1000)throw new Error('Invalid literal routing proposal collection');
    if(proposal.truncated)warnings.push('mapping-proposals-truncated');
    const dependencies={};
    for(const entry of proposal.proposals){
      if(entry.authority!=='proposal-only'||entry.status!=='review-required'||!entry.patch||Object.keys(entry.patch).some(key=>key!=='dependencies'))throw new Error('Invalid literal mapping proposal authority');
      for(const [test,inputs]of Object.entries(entry.patch.dependencies||{})){mappedPaths([test],'dependency tests');mappedPaths(inputs,'dependency inputs');dependencies[test]=[...new Set([...(dependencies[test]||[]),...inputs])];}
    }
    patch={dependencies};
  }
  const dependencies={...config.dependencies};
  for(const [test,inputs]of Object.entries(patch.dependencies||{}))dependencies[test]=[...new Set([...(dependencies[test]||[]),...inputs])];
  const candidate=validateConfig({...config,dependencies,...(patch.browser?{browser:{...config.browser,routes:{...config.browser?.routes,...patch.browser.routes},closedWorld:true}}:{})});
  return {candidate,warnings:[...new Set(warnings)],patch};
}

// Rebind workspace package symlinks into the copied source tree. Registry packages
// remain trusted installed dependencies; no package is fetched or installed.
function dependenciesInto(root,copy,files){
  let count=0;
  const directories=new Set(['node_modules',...files.filter(file=>file.endsWith('/package.json')).map(file=>path.posix.join(path.posix.dirname(file),'node_modules'))]);
  function linkDirectory(relative){
    const source=path.join(root,relative);if(!fs.existsSync(source))return;
    const destination=path.join(copy,relative);fs.mkdirSync(destination,{recursive:true});
    for(const entry of fs.readdirSync(source,{withFileTypes:true})){
      if(++count>10000)throw new Error('Installed dependency entry bound exceeded');
      const from=path.join(source,entry.name),to=path.join(destination,entry.name);
      if(entry.name.startsWith('@')&&entry.isDirectory()){linkDirectory(path.posix.join(relative,entry.name));continue;}
      const resolved=fs.realpathSync(from),within=path.relative(root,resolved);
      const local=!within.startsWith('..'+path.sep)&&within!=='..'&&!path.isAbsolute(within)&&!within.split(path.sep).includes('node_modules');
      const target=local?path.join(copy,within):resolved;
      if(local&&!fs.existsSync(target))throw new Error('Workspace dependency is outside copied source scope');
      fs.symlinkSync(target,to,fs.statSync(from).isDirectory()?'dir':'file');
    }
  }
  for(const directory of directories)linkDirectory(directory);
}
function copiedWorkspace(root,current,config,proposal,defects,action){
  const files=Object.keys(current.files),extra=(proposal.buildManifest?.artifacts||[]).flatMap(entry=>[entry.path,entry.map?.path].filter(Boolean));
  const artifactHashes=new Map((proposal.buildManifest?.artifacts||[]).flatMap(entry=>[entry,entry.map].filter(Boolean).map(artifact=>[artifact.path,artifact.sha256])));
  const all=[...new Set([...files,...extra])];if(all.length>MAX_FILES)throw new Error('Mapping qualification source file bound exceeded');
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-mapping-'));
  try{
    let total=0;
    for(const file of all){const source=safePath(root,file),size=fs.statSync(source).size;total+=size;if(size>MAX_FILE_BYTES||total>MAX_BYTES)throw new Error('Mapping qualification source byte bound exceeded');const destination=safePath(copy,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);if((current.files[file]||artifactHashes.get(file))&&digest(fs.readFileSync(destination))!==(current.files[file]||artifactHashes.get(file)))throw new Error('Source changed while copying mapping candidate');}
    dependenciesInto(root,copy,files);
    fs.writeFileSync(safePath(copy,'tddswarm.config.json'),JSON.stringify(config,null,2));
    for(const defect of defects)fs.writeFileSync(safePath(copy,defect.path),defect.content);
    const artifactsBefore=new Map(extra.map(file=>[file,digest(fs.readFileSync(safePath(copy,file)))]));
    const result=action(copy,config);
    for(const [file,hash]of artifactsBefore){let after=null;try{after=digest(fs.readFileSync(safePath(copy,file)));}catch{}if(after!==hash){result.freshness.fresh=false;result.freshness.reasons.push(`build-artifact-source-drift:${file}`);}}
    return result;
  }finally{fs.rmSync(copy,{recursive:true,force:true});}
}
const failed=report=>(report.tests||[]).filter(test=>test.status==='failed');
const brief=report=>({complete:report.complete===true,exitCode:report.exitCode,tests:report.tests||[],executedFiles:report.executedFiles||[],durationMs:report.durationMs||0,error:report.error||null,reportErrors:report.reportErrors||[]});
function nativeInventory(root,config){return discover(root,{...config,discovery:Array.isArray(config.discovery)?config.discovery:'native'});}
function boundedInventory(inventory){return inventory.complete&&inventory.files.length>0&&inventory.files.length<=MAX_CASES;}

/** Review-only qualification in independent disposable full/subset source copies. */
export function qualifyRoutingMappings(root,proposal,options={}){
  const started=performance.now();
  root=fs.realpathSync(path.resolve(root));
  const config=readConfig(root);
  if(Object.values(config.services||{}).some(service=>service?.probe!==undefined))throw new Error('Mapping qualification cannot execute service probes in the original workspace; use fixed or environment service versions');
  if(config.integration||!['node','jest','vitest','playwright'].includes(adapterFor(config)))throw new Error('Mapping qualification requires a supported native case-reporting adapter');
  const timeoutMs=options.timeoutMs??120000;if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new Error('Mapping qualification timeout must be 1000–120000 ms');
  const overallTimeoutMs=options.overallTimeoutMs??Math.min(timeoutMs*6,600000);if(!Number.isInteger(overallTimeoutMs)||overallTimeoutMs<1000||overallTimeoutMs>600000)throw new Error('Mapping qualification overall evaluation budget must be 1000–600000 ms');
  const budgetAvailable=()=>performance.now()-started<overallTimeoutMs;
  const changed=paths(root,options.changed,'changed');
  const defects=options.defects||[];if(!Array.isArray(defects)||defects.length>20)throw new Error('Mapping qualification supports at most 20 explicit source defects');
  for(const defect of defects){paths(root,[defect.path],'defect');if(!changed.includes(defect.path)||TEST.test(defect.path)||/config|package(?:-lock)?\.json|lock\.yaml|\.lock/.test(defect.path)||typeof defect.content!=='string'||Buffer.byteLength(defect.content)>512*1024||!fs.statSync(safePath(root,defect.path)).isFile())throw new Error('Defects must be bounded changed source inputs, never tests/configuration');}
  if(new Set(defects.map(defect=>defect.path)).size!==defects.length)throw new Error('Duplicate defect path');
  let sourceBytes=0;const sourceFiles=listFiles(root);if(sourceFiles.length>MAX_FILES)throw new Error('Mapping qualification source file bound exceeded');
  for(const file of sourceFiles){const size=fs.statSync(safePath(root,file)).size;sourceBytes+=size;if(size>MAX_FILE_BYTES||sourceBytes>MAX_BYTES)throw new Error('Mapping qualification source byte bound exceeded');}
  const current=snapshot(root,config),{candidate,warnings,patch}=proposalPatch(root,proposal,config,current);
  const executionConfig={...config,runnerTimeoutMs:timeoutMs},candidateConfig={...candidate,runnerTimeoutMs:timeoutMs};
  const fullResult=copiedWorkspace(root,current,executionConfig,proposal,defects,(copy,localConfig)=>{
    const before=snapshot(copy,localConfig),inventory=budgetAvailable()?nativeInventory(copy,localConfig):{files:[],complete:false,warnings:['overall-evaluation-budget-exceeded']};
    const full=boundedInventory(inventory)&&budgetAvailable()?execute(copy,inventory.files,localConfig,{capture:true,timeoutMs}):{complete:false,exitCode:2,tests:[],error:'Native full discovery is incomplete, empty or over bound'};
    return {inventory,full:brief(full),freshness:freshness(before,snapshot(copy,localConfig))};
  });
  const subsetResult=copiedWorkspace(root,current,candidateConfig,proposal,defects,(copy,localConfig)=>{
    const before=snapshot(copy,localConfig),inventory=budgetAvailable()?nativeInventory(copy,localConfig):{files:[],complete:false,warnings:['overall-evaluation-budget-exceeded']};
    let selection=null,subset={complete:false,exitCode:2,tests:[],error:'Native candidate discovery is incomplete, empty or over bound'};
    if(boundedInventory(inventory)&&budgetAvailable()){
      selection=plan(copy,{changed});
      subset=!budgetAvailable()?{complete:false,exitCode:2,tests:[],error:'Overall evaluation budget exceeded'}:selection.selected.length?execute(copy,selection.selected,localConfig,{capture:true,timeoutMs}):{complete:true,exitCode:0,tests:[],executedFiles:[],durationMs:0};
    }
    return {inventory,selection,subset:brief(subset),freshness:freshness(before,snapshot(copy,localConfig))};
  });
  const {full}=fullResult,{subset,selection}=subsetResult;
  const scope=[...new Set([...(selection?.selected||[]),...subset.executedFiles])];
  const preservation=compareSubsetCases(full,subset,scope);
  const fullIds=new Set(full.tests.map(test=>test.id)),subsetIds=new Set(subset.tests.map(test=>test.id));
  const missedFailures=failed(full).filter(test=>!subsetIds.has(test.id)||subset.tests.find(other=>other.id===test.id)?.status!=='failed');
  const unexpectedFailures=failed(subset).filter(test=>!fullIds.has(test.id)||full.tests.find(other=>other.id===test.id)?.status!=='failed');
  const missingFiles=fullResult.inventory.files.filter(file=>!subsetResult.inventory.files.includes(file)),extraFiles=subsetResult.inventory.files.filter(file=>!fullResult.inventory.files.includes(file));
  const drift=freshness(current,snapshot(root,config));
  if(proposal.buildManifest){try{validateBrowserBuildArtifacts(root,proposal.buildManifest);}catch{drift.fresh=false;drift.reasons.push('build-artifact-drift');}}
  const reasons=[...warnings,...fullResult.freshness.reasons,...subsetResult.freshness.reasons,...drift.reasons];
  if(!budgetAvailable())reasons.push('overall-evaluation-budget-exceeded');
  if(!full.complete||!subset.complete)reasons.push('native-execution-incomplete');
  if(full.tests.length>MAX_CASES||subset.tests.length>MAX_CASES)reasons.push('native-case-count-over-bound');
  if(missingFiles.length||extraFiles.length)reasons.push('native-inventory-changed');
  if(!preservation.complete)reasons.push('native-subset-cases-not-preserved');
  if(defects.length&&!failed(full).length)reasons.push('source-defect-not-demonstrated');
  if(missedFailures.length)reasons.push('missed-native-failures');
  if(unexpectedFailures.length)reasons.push('unexpected-native-subset-failures');
  if([...full.tests,...subset.tests].some(test=>test.status==='skipped'||test.outcome==='flaky'||test.attempts?.length>1))reasons.push('native-skips-or-retries');
  const complete=budgetAvailable()&&full.complete&&subset.complete&&fullResult.inventory.complete&&subsetResult.inventory.complete&&fullResult.freshness.fresh&&subsetResult.freshness.fresh&&drift.fresh&&full.tests.length<=MAX_CASES&&subset.tests.length<=MAX_CASES;
  const noObservedMisses=complete?missedFailures.length===0:null;
  const qualified=complete&&!reasons.length;
  const payload={schemaVersion:1,type:'mapping-qualification',proposalHash:digest(proposal),provenance:current,configurationHash:digest(config),candidateConfigurationHash:digest(candidate),patch,changed,defects:defects.map(defect=>({path:defect.path,sha256:digest(defect.content)})),reviewRequired:true,applied:false,closedWorld:false,qualified,complete,noObservedMisses,reasons:[...new Set(reasons)],full,subset,selection,inventory:{full:fullResult.inventory,candidate:subsetResult.inventory,missingFiles,extraFiles},preservation,missedFailures,unexpectedFailures,conservativeFallback:{required:!qualified||adapterFor(config)==='playwright',mode:'full',files:fullResult.inventory.files,inventoryComplete:fullResult.inventory.complete,requiresNativeFullDiscovery:!fullResult.inventory.complete,reason:!qualified?'mapping-qualification-incomplete-or-disagreed':adapterFor(config)==='playwright'?'browser-closed-world-review-required':null},budget:{nativeProcessTimeoutMs:timeoutMs,overallEvaluationBudgetMs:overallTimeoutMs,elapsedEvaluationMs:Math.round(performance.now()-started),hardWallClockBound:false,policy:'Check monotonic elapsed time before native phases and reject late results. Synchronous copying, snapshots, planning and final report sealing are not forcibly interrupted.'},isolation:'independent-disposable-source-copies-with-trusted-dependencies',limitations:LIMITATIONS,createdAt:new Date().toISOString()};
  return {...payload,integrity:digest(payload)};
}
