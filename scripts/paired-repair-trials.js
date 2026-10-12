#!/usr/bin/env node
// Explicit, bounded, private experiment. Native maintainer assertions are immutable.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {proposeRepair} from '../src/repair-swarm.js';
import {boundedProcess,safeHostEnvironment} from './host-qualification.js';
import {fileIdentity,assertFileIdentities} from './worker-identity.js';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const local=name=>fileURLToPath(new URL(name,import.meta.url));
const need=(value,message)=>{if(!value)throw Error(message);};
export function repairSchedule(){return [{repetition:0,arm:'without_memory'},{repetition:0,arm:'with_memory'},{repetition:1,arm:'with_memory'},{repetition:1,arm:'without_memory'}];}
export function assessNativeRepairRun(receipt,process,expected){
 const reasons=[],rows=receipt?.tests;
 if(receipt?.schemaVersion!==1||receipt.kind!=='uvu-0.3.3-passive-outcomes'||!Array.isArray(receipt.errors)||receipt.errors.length||!Array.isArray(rows)||rows.length!==137||new Set(rows.map(row=>row.id)).size!==137||rows.some(row=>!['passed','failed'].includes(row.status)||typeof row.name!=='string'||row.name.length>2048||!/^test\/(?:index|full|lite|json)\.js$/.test(row.file)||!/^test\/suites\/[a-z]+\.js$/.test(row.registration?.file||'')||!Number.isSafeInteger(row.registration.line)||row.registration.line<1||!Number.isSafeInteger(row.registration.column)||row.registration.column<1||! /^[a-f0-9]{64}$/.test(row.registration.sha256)||row.id!==hash(JSON.stringify([row.file,row.name.split(' > ')[0],row.name.split(' > ').slice(1).join(' > '),row.registration]))))reasons.push('native-complete-identity-inventory-unverified');
 const passed=rows?.filter(row=>row.status==='passed').length,failed=rows?.filter(row=>row.status==='failed').length;
 const text=process?.stdout?.replace(/\x1b\[[0-9;]*m/g,'')||'';
 const knownAssertionFooter=process?.exitCode===1&&failed>0&&rows.filter(row=>row.status==='failed').every(row=>row.error?.name==='AssertionError'&&typeof row.error.message==='string')&&process.stderr==='npm ERR! Test failed.  See above for more details.\n';
 const totals=[...text.matchAll(/^  Total:     ([0-9]+)$/gm)],passes=[...text.matchAll(/^  Passed:    ([0-9]+)$/gm)],skips=[...text.matchAll(/^  Skipped:   ([0-9]+)$/gm)];
 if(process?.status!=='completed'||process.signal||process.stderr!==''&&!knownAssertionFooter||![0,1].includes(process.exitCode)||receipt?.exitCode!==process.exitCode||process.exitCode!==(failed?1:0)||totals.length!==1||Number(totals[0][1])!==137||passes.length!==1||Number(passes[0][1])!==passed||skips.length!==1||Number(skips[0][1])!==0)reasons.push('native-terminal-summary-unverified');
 if(expected&&JSON.stringify(rows?.map(row=>[row.id,row.file,row.name]).sort())!==JSON.stringify(expected.map(row=>[row.id,row.file,row.name]).sort()))reasons.push('native-original-inventory-drift');
 return {complete:reasons.length===0,reasons,exitCode:process?.exitCode,tests:rows||[],passed,failed,process};
}
export function assessPairedRepair(trials){
 need(Array.isArray(trials)&&trials.length<=4&&trials.every(row=>[0,1].includes(row.repetition)&&['with_memory','without_memory'].includes(row.arm))&&new Set(trials.map(row=>row.repetition+':'+row.arm)).size===trials.length,'Unknown or duplicate paired observation');
 const pairs=[0,1].map(repetition=>{const rows=trials.filter(row=>row.repetition===repetition),m=rows.find(row=>row.arm==='with_memory'),c=rows.find(row=>row.arm==='without_memory');return {repetition,complete:!!m&&!!c,repairDelta:Number(m?.qualified===true)-Number(c?.qualified===true),effectiveTreatment:m?.proposal?.contributionRetrieval?.status==='recalled',totalMsDelta:m&&c?m.totalMs-c.totalMs:null};});
 return {observedTrials:trials.length,pairs,inference:'inconclusive-single-historical-defect-pilot',learningPromotion:false,billingUSD:null};
}
export async function runPairedRepairs({upstream,fault,node,history,output,execute=false,nativeOnly=false}={}){
 need(execute===true,'Explicit execution authorization required');
 for(const value of [upstream,fault,node,history,output])need(typeof value==='string'&&path.isAbsolute(value),'Absolute explicit paths required');
 need(!fs.existsSync(output),'Output must be new');fs.mkdirSync(output,{recursive:true,mode:0o700});
 const start=performance.now(),deadline=start+15*60*1000,tracked=JSON.parse(fs.readFileSync(path.join(upstream,'package.json')));
 need(tracked.name==='klona'&&tracked.version==='2.0.4'&&tracked.scripts.test==='uvu -r esm test -i suites'&&tracked.devDependencies.uvu==='0.3.3','Exact reviewed native profile required');
 const requirements='Deep-clone class instances while preserving the class constructor and the original instance own properties, including properties populated by Object.assign(this, data) inside a constructor. Recursive values must be copied. Preserve all other original maintainer cloning contracts. Original independently maintained class assertions define expected behavior; do not alter tests or dependencies.';
 const fixed=fs.readFileSync(path.join(upstream,'src/index.js')),faultBytes=fs.readFileSync(fault),historyBytes=fs.readFileSync(history),corpus=JSON.parse(historyBytes);
 need(spawnSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8',timeout:10000}).stdout?.trim()==='7650274e756c5fa9e7db707db89c0b4fd32895ad','Original Git revision mismatch');
 need(spawnSync('git',['diff','HEAD','--exit-code'],{cwd:upstream,timeout:10000}).status===0,'Original tracked upstream bytes changed');
 const historical=spawnSync('git',['show','28565c3efae17b3c72c5086602437841cb1435b8:src/index.js'],{cwd:upstream,timeout:10000,maxBuffer:65536});need(historical.status===0&&hash(historical.stdout)===hash(faultBytes),'Historical parent source binding mismatch');
 need(hash(fixed)==='44d2d2a5ead81851de1982360c27bd2be4b90e1005871fd9f18005480937bae9'&&hash(faultBytes)==='864c5277b6aef281324c65db6365b3c888df5b4b2469236399002477f5342bbc','Reviewed fixed/parent source byte binding mismatch');
 need(!corpus.records.some(row=>row.repository.toLowerCase()==='lukeed/klona'),'Holdout repository appears in history');
 need(hash(fixed)!==hash(faultBytes),'Actual historical fault required');
 const implementation=[];
 const bindRuntime=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const target=path.join(directory,entry.name);if(entry.isDirectory())bindRuntime(target);else if(/\.(?:[cm]?js|json)$/.test(entry.name)){need(!entry.isSymbolicLink(),'Runtime source symlink unsupported');implementation.push(fileIdentity(target));}need(implementation.length<=512,'Runtime binding inventory exceeded');}};
 bindRuntime(local('../src'));bindRuntime(local('./'));implementation.push(fileIdentity(local('../package.json')),fileIdentity(local('../package-lock.json')));
 const controllerNode=fileIdentity(process.execPath,512*1024*1024);
 const seal=directory=>{
  const rows=[];const walk=(at,prefix='')=>{for(const entry of fs.readdirSync(at,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(!prefix&&['.git','.tddswarm','node_modules','dist','full','json','lite'].includes(entry.name))continue;const relative=prefix+entry.name,target=path.join(at,entry.name);need(!entry.isSymbolicLink(),'Unexpected source symlink');if(entry.isDirectory())walk(target,relative+'/');else {need(entry.isFile(),'Unexpected source entry');rows.push([relative,hash(fs.readFileSync(target))]);}need(rows.length<=256,'Source inventory exceeded');}};walk(directory);return rows;};
 const ensure=()=>{need(performance.now()<deadline,'Controller deadline exhausted');const stat=fs.statfsSync(output);need(stat.bavail*stat.bsize>=1024**3,'Working reserve exhausted');assertFileIdentities(implementation);need(JSON.stringify(fileIdentity(controllerNode.path,512*1024*1024))===JSON.stringify(controllerNode),'Controller Node binary identity drift');};
 const write=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
 const installed=directory=>{const rows=[];let total=0;const walk=(at,prefix='')=>{for(const entry of fs.readdirSync(at,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix+entry.name,target=path.join(at,entry.name);if(entry.isDirectory())walk(target,relative+'/');else if(entry.isSymbolicLink()){const actual=fs.realpathSync(target);need(actual.startsWith(directory+path.sep),'Installed symlink outside qualified tree');rows.push([relative,'symlink',fs.readlinkSync(target),hash(fs.readFileSync(actual))]);}else{need(entry.isFile(),'Unsupported installed entry');const bytes=fs.readFileSync(target);total+=bytes.length;need(total<=64*1024*1024,'Installed inventory exceeded');rows.push([relative,hash(bytes)]);}need(rows.length<=4096,'Installed entries exceeded');}};walk(directory);return {sha256:hash(rows),rows};};
 const npmRoot=path.join(path.dirname(node),'../lib/node_modules/npm');
 const nativeIdentities=[fileIdentity(node,512*1024*1024),fileIdentity(path.join(npmRoot,'bin/npm-cli.js'))],originalInstalled=installed(path.join(upstream,'node_modules')),originalNpm=installed(npmRoot);
 const nativeFresh=()=>{for(const identity of nativeIdentities)need(JSON.stringify(fileIdentity(identity.path,512*1024*1024))===JSON.stringify(identity),'Native executable identity drift');};
 need(spawnSync(node,['--version'],{encoding:'utf8',timeout:10000}).stdout?.trim()==='v12.22.12','Reviewed native Node12 patch required');
 for(const [name,version]of [['uvu','0.3.3'],['esm','3.2.25'],['bundt','1.0.2']])need(JSON.parse(fs.readFileSync(path.join(upstream,'node_modules',name,'package.json'))).version===version,'Exact native dependency version required');
 const nativeHome=path.join(output,'native-home'),nativeTmp=path.join(output,'native-tmp');fs.mkdirSync(nativeHome);fs.mkdirSync(nativeTmp);
 const npmConfig=path.join(output,'empty-npmrc');fs.writeFileSync(npmConfig,'',{flag:'wx',mode:0o600});
 const commitment={schemaVersion:1,kind:'prospective-native-source-repair-ablation',repository:'lukeed/klona',fixedRevision:'7650274e756c5fa9e7db707db89c0b4fd32895ad',parentRevision:'28565c3efae17b3c72c5086602437841cb1435b8',intervention:'replace only src/index.js with exact parent bytes; fixed revision original full assertion inventory unchanged',fixedSourceSha256:hash(fixed),faultSourceSha256:hash(faultBytes),historySha256:hash(historyBytes),historyRecords:corpus.records.length,excludedRepositoryRecords:0,requirements,requirementsSha256:hash(requirements),sourceSeal:seal(upstream),implementation,schedule:repairSchedule(),budget:{agentCalls:12,nativeCalls:20,roleTimeoutMs:110000,trialDeadlineMs:330000,maximumOutputBytes:65536,controllerDeadlineMs:900000},createdAt:new Date().toISOString(),nativeAdjustments:{unhandledRejections:'strict equally all native arms',esmCache:'ESM_DISABLE_CACHE=1 equally all native arms',nativePersonalHome:false},heldoutFromAgent:'historical fixed src/index.js; no tools permitted',modelTrainingIsolation:'unknown',billingUSD:null};write('commitment.json',commitment);
 write('native-identities.json',{nativeIdentities,originalInstalled,originalNpm,nodeVersion:'v12.22.12',originalUpstreamLockfile:false,installedLockfileSha256:hash(fs.readFileSync(path.join(upstream,'package-lock.json')))});
 const native=async(root,label,expected)=>{
  ensure();const target=path.join(output,label+'.observer.json'),sourceBefore=seal(root);
  nativeFresh();need(installed(path.join(root,'node_modules')).sha256===originalInstalled.sha256&&installed(npmRoot).sha256===originalNpm.sha256,'Installed native dependency identity drift');
  const env={HOME:nativeHome,TMPDIR:nativeTmp,PATH:path.dirname(node)+':/usr/bin:/bin',LANG:'C',ESM_DISABLE_CACHE:'1',npm_config_update_notifier:'false',npm_config_userconfig:npmConfig,npm_config_globalconfig:npmConfig,NODE_OPTIONS:'--unhandled-rejections=strict --require='+local('paired-repair-uvu-observer.cjs'),TESTLORE_UVU_RECEIPT:target};
  const result=await boundedProcess(node,[path.join(path.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js'),'test'],{cwd:root,env,timeoutMs:Math.max(1,Math.min(20000,Math.floor(deadline-performance.now()))),maximumBytes:256*1024});write(label+'.process.json',result);
  nativeFresh();need(installed(path.join(root,'node_modules')).sha256===originalInstalled.sha256&&installed(npmRoot).sha256===originalNpm.sha256,'Installed dependencies changed during native execution');need(JSON.stringify(seal(root))===JSON.stringify(sourceBefore),'Original source/oracle changed during native execution');ensure();
  let receipt;try{receipt=JSON.parse(fs.readFileSync(target));}catch{}const assessment=assessNativeRepairRun(receipt,result,expected);write(label+'.assessment.json',assessment);return assessment;
 };
 const baseline=await native(upstream,'fixed-0'),baseline2=await native(upstream,'fixed-1',baseline.tests);
 need(baseline.complete&&baseline.failed===0&&baseline2.complete&&baseline2.failed===0,'Original native fixed suite not qualified');
 fs.writeFileSync(path.join(upstream,'src/index.js'),faultBytes);
 let red,red2;try{red=await native(upstream,'fault-0',baseline.tests);red2=await native(upstream,'fault-1',baseline.tests);}finally{fs.writeFileSync(path.join(upstream,'src/index.js'),fixed);}
 need(red.complete&&red.failed===1&&red2.complete&&red2.failed===1&&JSON.stringify(red.tests.filter(x=>x.status==='failed'))===JSON.stringify(red2.tests.filter(x=>x.status==='failed')),'Independent native historical failure not repeatable');
 need(red.tests.find(row=>row.status==='failed').name==='class > constructor properties :: Object.assign','Unexpected historical failure');
 if(nativeOnly){const result={complete:true,kind:'native-repair-cohort-admission',agentCalls:0,nativeRuns:4,fixedPassed:137,faultPassed:136,faultFailed:1,caseIdentities:baseline.tests.map(({id,file,name,registration})=>({id,file,name,registration})),memoryComparisonExecuted:false,learningPromotion:false};write('native-admission.json',result);return result;}
 const trials=[];
 for(const item of repairSchedule()){
  ensure();const begin=performance.now(),label='trial-'+item.repetition+'-'+item.arm,root=path.join(output,label),calls=path.join(output,label+'-calls');fs.mkdirSync(calls);
  fs.cpSync(upstream,root,{recursive:true,verbatimSymlinks:true,filter:source=>!['.tddswarm'].includes(path.basename(source))});fs.writeFileSync(path.join(root,'src/index.js'),faultBytes);
  const config={adapter:'node',learning:{enabled:item.arm==='with_memory',contributions:{enabled:item.arm==='with_memory'}}};fs.writeFileSync(path.join(root,'tddswarm.config.json'),JSON.stringify(config));
  if(item.arm==='with_memory'){const target=path.join(root,'.tddswarm/learning/contributions');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'index.json'),historyBytes);}
  const before=seal(root),trial={...item,qualified:false,totalMs:null,providerCalls:0,billingUSD:null};
  try{
   const failing=await native(root,label+'-before',baseline.tests);need(failing.complete&&failing.failed===1,'Fresh trial red baseline incomplete');
   const remaining=Math.floor(deadline-performance.now());need(remaining>0,'Controller deadline exhausted');
   trial.proposal=await proposeRepair(root,{agent:[process.execPath,local('paired-repair-worker.js'),calls],sourcePaths:['src/index.js'],requirements,baseline:failing,timeoutMs:Math.min(110000,remaining),deadlineMs:Math.min(330000,remaining),maxTasks:1,maxOutputBytes:65536,assertInputsFresh:ensure});
   trial.providerCalls=trial.proposal.attemptedCalls;need(trial.proposal.accepted===true&&trial.proposal.files.length===1&&trial.proposal.files[0].path==='src/index.js','Proposal rejected');
   need(JSON.stringify(seal(root))===JSON.stringify(before),'Agent changed protected source');fs.writeFileSync(path.join(root,'src/index.js'),trial.proposal.files[0].content);
   trial.candidate=await native(root,label+'-candidate-0',baseline.tests);trial.candidate2=await native(root,label+'-candidate-1',baseline.tests);
   need(trial.candidate.complete&&trial.candidate.failed===0&&trial.candidate2.complete&&trial.candidate2.failed===0,'Candidate native full suite failed or incomplete');
   const after=seal(root);need(JSON.stringify(after.filter(([file])=>file!=='src/index.js'))===JSON.stringify(before.filter(([file])=>file!=='src/index.js')),'Protected source changed');
   trial.qualified=true;
  }catch(error){trial.error=String(error.message).slice(0,2048);if(error.repairSwarm){trial.proposal=error.repairSwarm;trial.providerCalls=error.repairSwarm.attemptedCalls;}}
  const reports=fs.readdirSync(calls).map(name=>JSON.parse(fs.readFileSync(path.join(calls,name))));trial.nativeUsage=reports.map(row=>({role:row.role,status:row.status,audit:row.result?.audit||null,inputBytes:Buffer.byteLength(JSON.stringify(row.payload)),outputBytes:row.result?Buffer.byteLength(JSON.stringify(row.result.value)):null,billingUSD:null}));trial.callsWithoutUsage=Math.max(trial.providerCalls-reports.filter(row=>row.result?.audit?.usage).length,0);
  trial.totalMs=Math.round(performance.now()-begin);trials.push(trial);write(label+'.result.json',trial);
 }
 const summary={schemaVersion:1,kind:'native-paired-repair-pilot',commitmentSha256:hash(fs.readFileSync(path.join(output,'commitment.json'))),trials,comparison:assessPairedRepair(trials),controllerMs:Math.round(performance.now()-start),learningAdvisory:true,learningPromotion:false,limitations:['Single real historical defect; repeated trials are clustered, not independent defect samples.','Original UVU framework and maintainer assertion bodies unchanged; passive handler observer adds measurement overhead.','Node12 original CI major runs under macOS Rosetta, not the original Ubuntu CI platform.','Metadata retrieval is advisory; recalled metadata is not independently verified repair knowledge.','No provider model training isolation or dollar cost attestation.','A source-only historical intervention is not the complete parent tree.','Tool attempts fail the native transport; read-only host isolation is not a general security sandbox.']};write('summary.json',summary);return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const options=JSON.parse(fs.readFileSync(process.argv[2])),result=await runPairedRepairs(options);console.log(JSON.stringify(result.comparison||result));}catch(error){console.error(error.message);process.exitCode=2;}
}
