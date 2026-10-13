#!/usr/bin/env node
// Observed development replay, never an untouched holdout or admission token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureTypecheckInputs,verifyTypecheck} from '../src/typecheck.js';
import {summarizeTypecheck} from '../src/typecheck-report.js';

const repository=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=path.join(repository,'benchmarks/type-detection/development-v1');
const manifestBytes=fs.readFileSync(path.join(base,'manifest.json'));
const manifest=JSON.parse(manifestBytes);
const MANIFEST_SHA='b4130e918e9d6a91edace4eb46e7a227aff46c88212a07760a85ed90942f0b39';
const producerPaths=['typecheck.js','reporters/typecheck-worker.cjs','provenance.js','files.js','inputs.js','configuration-inputs.js','plugin-config.js'];
function inventory(directory,prefix='') {
  return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).flatMap(entry=>{
    const file=prefix+entry.name,target=path.join(directory,entry.name),stat=fs.lstatSync(target);
    if(stat.isDirectory())return inventory(target,file+'/');
    if(!stat.isFile()||stat.size>32*1024*1024)throw Error('Unsupported SDK entry');
    return [{file,sha256:hash(fs.readFileSync(target)),bytes:stat.size}];
  });
}
function execute(args,cwd,output,role) {
  const started=performance.now(),env={PATH:path.dirname(process.execPath),HOME:cwd,TMPDIR:os.tmpdir(),LANG:'C',LC_ALL:'C'};
  const result=spawnSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  const stdout=result.stdout||'',stderr=result.stderr||'';
  fs.writeFileSync(path.join(output,role+'.stdout'),stdout,{flag:'wx'});
  fs.writeFileSync(path.join(output,role+'.stderr'),stderr,{flag:'wx'});
  const receipt={command:[process.execPath,...args],exitCode:result.status,signal:result.signal,error:result.error?.code||null,
    durationMs:performance.now()-started,stdoutSha256:hash(stdout),stderrSha256:hash(stderr),
    diagnosticCodes:[...new Set([...stdout.matchAll(/\bTS([0-9]+):/g)].map(x=>Number(x[1])))].sort((a,b)=>a-b),
    assertionCompletionMarker:stdout==='ordinary-input assertions passed\n'};
  fs.writeFileSync(path.join(output,role+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return receipt;
}
export function assessDevelopmentRows(rows) {
  const sdk=path.join(repository,'node_modules/typescript'),sdkRows=inventory(sdk);
  assert.equal(hash(JSON.stringify(sdkRows)),manifest.compilerRequirement.originClosureSha256);
  const producers=producerPaths.map(file=>({file,sha256:hash(fs.readFileSync(path.join(repository,'src',file)))}));
  const expected=manifest.specs.flatMap(spec=>Object.keys(spec.states).flatMap(state=>[0,1].map(repeat=>({id:spec.id,state,repeat,tier:spec.qualificationTier}))));
  const key=row=>JSON.stringify([row.id,row.state,row.repeat]);
  const map=new Map();
  for(const row of rows){if(map.has(key(row)))throw Error('Duplicate development exposure');map.set(key(row),row);}
  assert.equal(rows.length,expected.length,'Incomplete development exposure inventory');
  let faults=0,healthyFailures=0,incomplete=0,unsupported=0,nativePassed=0;
  const detected=new Set();
  for(const identity of expected){
    const row=map.get(key(identity));assert.ok(row,'Missing development exposure');assert.equal(row.tier,identity.tier);
    if(row.native.exitCode===0&&!row.native.error&&!row.native.signal&&row.native.assertionCompletionMarker===true&&
      row.native.stdoutSha256===hash('ordinary-input assertions passed\n')&&row.native.stderrSha256===hash(''))nativePassed++;
    const spec=manifest.specs.find(item=>item.id===row.id),check=row.typecheck;
    const state=spec.states[row.state],binding=check.binding;
    assert.ok(binding&&Array.isArray(binding.source?.files)&&Array.isArray(binding.dependencies?.files),'Missing actual input inventory');
    assert.equal(binding.source.sha256,hash(JSON.stringify(binding.source.files)),'Source inventory checksum mismatch');
    assert.equal(binding.dependencies.sha256,hash(JSON.stringify(binding.dependencies.files)),'Dependency inventory checksum mismatch');
    const sourceRows=binding.source.files.filter(item=>item.kind==='file').map(({file,sha256,size})=>({file,sha256,bytes:size})).sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
    assert.deepEqual(sourceRows,state.sourceInputs,'Wrong exposure source binding');
    const dependencyRows=binding.dependencies.files.filter(item=>item.kind==='file').map(({file,sha256,size})=>({file:file.replace(/^node_modules\/typescript\//,''),sha256,bytes:size}));
    assert.deepEqual(dependencyRows,sdkRows,'Wrong compiler closure');
    assert.deepEqual(binding.producers,producers,'Producer closure changed');
    assert.equal(binding.node.sha256,hash(fs.readFileSync(process.execPath)),'Wrong actual Node runtime');
    assert.equal(binding.projectSha256,state.sourceInputs.find(input=>input.file==='tsconfig.json').sha256);
    assert.equal(check.compiler?.version,manifest.compilerRequirement.version);
    assert.equal(check.compiler?.sha256,sdkRows.find(input=>input.file==='lib/typescript.js').sha256);
    assert.equal(check.compiler?.manifestSha256,sdkRows.find(input=>input.file==='package.json').sha256);
    if(row.tier!=='ordinary-project'){
      assert.equal(check.complete,false);assert.equal(check.status,'incomplete');assert.equal(check.exitCode,2);
      assert.equal(check.signal,null);assert.equal(check.errorCode,'typecheck-project-references-unsupported');
      assert.deepEqual(check.reasons,['typecheck-project-references-unsupported']);unsupported++;continue;
    }
    const original=row.originalChecker;
    assert.ok(original&&!original.error&&!original.signal,'Original checker incomplete');
    assert.equal(original.exitCode,spec.states[row.state].expectedOriginalCheckerExit);
    assert.deepEqual(original.diagnosticCodes,row.state==='fault'?spec.diagnosticCodes:[]);
    if(!summarizeTypecheck(check).complete||![0,1].includes(check.exitCode)){incomplete++;continue;}
    if(row.state==='healthy'){if(check.exitCode!==0||check.status!=='passed')healthyFailures++;}
    else if(check.status==='failed'&&check.exitCode===1&&spec.diagnosticCodes.every(code=>check.diagnostics?.some(d=>d.category==='error'&&d.code===code))){faults++;detected.add(row.id);}
  }
  return {qualified:nativePassed===24&&faults===10&&detected.size===5&&healthyFailures===0&&incomplete===0&&unsupported===4,
    uniqueSeededDevelopmentDefectsDetected:detected.size,faultExposuresDetected:faults,healthyFalsePositives:healthyFailures,
    ordinaryIncomplete:incomplete,unsupportedReferenceExposures:unsupported,nativeProbePasses:nativePassed,
    referenceQualified:false,upstreamBugClaim:false,learningImprovementClaim:false,superiorityClaim:false};
}
export function verifyReplay(file){
  const summary=JSON.parse(fs.readFileSync(file)),output=path.dirname(file);
  assert.equal(summary.kind,'observed-development-type-detection-replay');assert.equal(summary.manifestSha256,MANIFEST_SHA);
  assert.equal(summary.producerSha256,hash(fs.readFileSync(fileURLToPath(import.meta.url))),'Replay producer changed');
  for(const row of summary.rows){
    const directory=path.join(output,`${row.id}-${row.state}-${row.repeat}`);
    for(const [role,receipt]of [['native',row.native],['original-tsc',row.originalChecker]]){
      if(!receipt)continue;
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,role+'.json'))),receipt);
      const stdout=fs.readFileSync(path.join(directory,role+'.stdout')),stderr=fs.readFileSync(path.join(directory,role+'.stderr'));
      assert.equal(hash(stdout),receipt.stdoutSha256);assert.equal(hash(stderr),receipt.stderrSha256);
      if(role==='native')assert.equal(stdout.toString(),'ordinary-input assertions passed\n');
      else assert.deepEqual([...new Set([...stdout.toString().matchAll(/\bTS([0-9]+):/g)].map(x=>Number(x[1])))].sort((a,b)=>a-b),receipt.diagnosticCodes);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'typecheck.json'))),row.typecheck);
    const opening=JSON.parse(fs.readFileSync(path.join(directory,'opening-inputs.json')));
    assert.equal(opening.status,'captured');assert.equal(opening.sourceSha256,row.typecheck.binding.source.sha256);
    assert.equal(opening.dependencySha256,row.typecheck.binding.dependencies.sha256);
    assert.equal(opening.provenanceFingerprint,row.typecheck.binding.provenance.fingerprint);
  }
  const result=assessDevelopmentRows(summary.rows);assert.equal(result.qualified,true);return result;
}
export function challengeEvaluator(file){
  const summary=JSON.parse(fs.readFileSync(file));assert.equal(assessDevelopmentRows(summary.rows).qualified,true);
  const cases=[
    ['empty-native-output',rows=>{rows[0].native.stdoutSha256=hash('');}],
    ['missing-native-marker',rows=>{rows[0].native.assertionCompletionMarker=false;}],
    ['zero-type-scope',rows=>{rows[0].typecheck.files=[];}],
    ['copied-other-fault',rows=>{const target=rows.find(r=>r.id==='nullable-branch'&&r.state==='fault');target.typecheck=structuredClone(rows.find(r=>r.id==='return-contract'&&r.state==='fault').typecheck);}],
    ['wrong-sdk-hash',rows=>{rows[0].typecheck.compiler.sha256='0'.repeat(64);}],
    ['reference-timeout',rows=>{rows.find(r=>r.tier!=='ordinary-project').typecheck.errorCode='typecheck-timeout';}],
    ['ordinary-incomplete',rows=>{rows[0].typecheck.complete=false;}],
    ['healthy-error-hidden',rows=>{rows[0].typecheck.diagnostics.push({code:2322,category:'error',file:'module.ts',line:1,column:1,message:'independent evaluator mutant'});}],
    ['duplicate-exposure',rows=>{rows[1]=structuredClone(rows[0]);}],
    ['unknown-exposure',rows=>{rows[0].id='unknown';}],
    ['missing-exposure',rows=>{rows.pop();}]
  ];
  const controls=cases.map(([id,mutate])=>{
    const rows=structuredClone(summary.rows);mutate(rows);let rejected=false;
    try{rejected=assessDevelopmentRows(rows).qualified!==true;}catch{rejected=true;}
    assert.equal(rejected,true,'Evaluator admitted '+id);return {id,rejected};
  });
  return {kind:'development-evaluator-challenges',qualified:true,controls};
}
export function main(args=process.argv.slice(2)) {
  if(args.length===2&&args[0]==='--verify'){console.log(JSON.stringify(verifyReplay(path.resolve(args[1])),null,2));return 0;}
  if(args.length===2&&args[0]==='--challenge-evaluator'){console.log(JSON.stringify(challengeEvaluator(path.resolve(args[1])),null,2));return 0;}
  if(args.length!==2||args[0]!=='--output')throw Error('Use --output NEW_DIRECTORY');
  assert.equal(hash(manifestBytes),MANIFEST_SHA,'Frozen public manifest changed');
  const output=path.resolve(args[1]);if(fs.existsSync(output))throw Error('Preserve evidence: output must be new');
  const sdk=path.join(repository,'node_modules/typescript');
  const sdkPackage=JSON.parse(fs.readFileSync(path.join(sdk,'package.json')));
  assert.equal(sdkPackage.name,'typescript');assert.equal(sdkPackage.version,manifest.compilerRequirement.version);
  const sdkRows=inventory(sdk),sdkSha=hash(JSON.stringify(sdkRows));
  assert.equal(sdkSha,manifest.compilerRequirement.originClosureSha256,'Original SDK closure differs');
  for(const spec of manifest.specs){
    const healthy=spec.states.healthy.sourceInputs,fault=spec.states.fault.sourceInputs;
    assert.equal(healthy.find(x=>x.file==='probe.mjs').sha256,fault.find(x=>x.file==='probe.mjs').sha256);
    const differences=healthy.filter(x=>fault.find(y=>y.file===x.file)?.sha256!==x.sha256);
    assert.equal(differences.length,1);assert.ok(differences[0].file.endsWith('.ts'));
    for(const state of Object.values(spec.states))for(const input of state.sourceInputs){
      const bytes=fs.readFileSync(path.join(base,state.directory,input.file));
      assert.equal(bytes.length,input.bytes);assert.equal(hash(bytes),input.sha256);
    }
  }
  fs.mkdirSync(output,{recursive:true});const started=performance.now(),rows=[],producerSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));
  for(const spec of manifest.specs)for(const [stateName,state]of Object.entries(spec.states))for(let repeat=0;repeat<2;repeat++){
    const rowStart=performance.now(),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-type-development-'));
    const destination=path.join(output,`${spec.id}-${stateName}-${repeat}`);fs.mkdirSync(destination);
    try{
      for(const input of state.sourceInputs){const target=path.join(scratch,input.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(base,state.directory,input.file),target);}
      const localSdk=path.join(scratch,'node_modules/typescript');fs.mkdirSync(path.dirname(localSdk),{recursive:true});fs.cpSync(sdk,localSdk,{recursive:true});
      assert.equal(hash(JSON.stringify(inventory(localSdk))),sdkSha);
      const openingInputs=captureTypecheckInputs(scratch,{timeoutMs:30000});
      fs.writeFileSync(path.join(destination,'opening-inputs.json'),JSON.stringify(openingInputs,null,2)+'\n',{flag:'wx'});
      const native=execute(['--experimental-strip-types','--no-warnings','probe.mjs'],scratch,destination,'native');
      const typecheck=verifyTypecheck(scratch,{timeoutMs:30000,openingInputs});
      fs.writeFileSync(path.join(destination,'typecheck.json'),JSON.stringify(typecheck,null,2)+'\n',{flag:'wx'});
      // The reference build's original cache-sensitive exit mismatch remains recorded in the manifest.
      // Never run an emitting build in the typecheck arm or score its unsupported result as a win.
      const originalChecker=spec.qualificationTier==='ordinary-project'?
        execute(['node_modules/typescript/lib/tsc.js',...state.originalCheckerArgs],scratch,destination,'original-tsc'):null;
      for(const input of state.sourceInputs)assert.equal(hash(fs.readFileSync(path.join(scratch,input.file))),input.sha256,'Source drift');
      assert.equal(hash(JSON.stringify(inventory(localSdk))),sdkSha,'SDK drift');
      rows.push({id:spec.id,state:stateName,repeat,tier:spec.qualificationTier,native,typecheck,originalChecker,
        stagingNativeTypecheckOriginalAndEvidenceMs:performance.now()-rowStart});
    }finally{fs.rmSync(scratch,{recursive:true,force:true});}
  }
  assert.equal(hash(JSON.stringify(inventory(sdk))),sdkSha,'Installed SDK drift');
  assert.equal(hash(fs.readFileSync(path.join(base,'manifest.json'))),MANIFEST_SHA);
  assert.equal(hash(fs.readFileSync(fileURLToPath(import.meta.url))),producerSha256,'Producer drift');
  const result={schemaVersion:1,kind:'observed-development-type-detection-replay',manifestSha256:MANIFEST_SHA,
    originManifestSha256:manifest.originManifestSha256,producerSha256,
    node:process.version,sdk:{version:sdkPackage.version,closureSha256:sdkSha,files:sdkRows.length},
    ...assessDevelopmentRows(rows),rows,totalControllerBeforeFinalReceiptMs:performance.now()-started,
    limitations:manifest.limits,protectedHoldout:false,cost:null};
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({...assessDevelopmentRows(rows),output,totalControllerMs:result.totalControllerBeforeFinalReceiptMs},null,2));
  return result.qualified?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=main();}catch(error){console.error(error.message);process.exitCode=1;}
}
