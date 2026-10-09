import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bunResults,readBunReport,bunBaselineAdmission,bunTrialBudget} from '../src/bun-results.js';
import {run,compareSubsetCases} from '../src/runner.js';
import {git,safePath} from '../src/files.js';
import {readNativeJson} from '../src/native-protocol.js';
import {fileIdentity} from './worker-identity.js';

export const CLAUDE_MEM_PIN='fa8ab09f06aa05f958c5225cf3756ce52a3ebb96';
export const BUN_VERSION='1.4.2';
const source='src/services/worker/http/routes/SessionRoutes.ts';
const oracle='tests/worker/http/routes/native-prompt-init.test.ts';
const historicalFix='c84c04756ac935add118e875f1f65d963d650d30';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function trackedHash(root,file){
 const absolute=path.resolve(root,file);if(!absolute.startsWith(root+path.sep))throw new Error('Tracked path escapes campaign root');
 if(fs.lstatSync(absolute).isSymbolicLink())return digest('symlink:'+fs.readlinkSync(absolute));
 return digest(fs.readFileSync(safePath(root,file)));
}
/** Inputs must be a disposable clean checkout with original dependencies installed.
 * This script never installs, starts a personal worker, or builds/syncs a plugin. */
export function claudeMemPilot({root,output,home,installationReceipt}) {
 const campaignStarted=performance.now();
 root=fs.realpathSync(root);output=path.resolve(output);home=path.resolve(home);
 if(home===process.env.HOME||!home.startsWith(output+path.sep))throw new Error('Campaign HOME must be isolated inside its new output directory');
 if(fs.existsSync(output))throw new Error('Evidence directory must be new');
 if(git(root,['rev-parse','HEAD']).trim()!==CLAUDE_MEM_PIN||git(root,['status','--porcelain']).trim())throw new Error('Campaign needs the pinned, clean claude-mem checkout');
 if(!fs.statSync(path.join(root,'node_modules')).isDirectory())throw new Error('Install original declared dependencies separately in isolation first');
 fs.mkdirSync(home,{recursive:true});fs.mkdirSync(path.join(output,'tmp'));
 const env={PATH:process.env.PATH,HOME:home,TMPDIR:path.join(output,'tmp'),CI:'1',NODE_ENV:'test',AGENT:'0',CLAUDE_MEM_DISABLE_TELEMETRY:'true'};
 const oldEnv={...process.env};
 const protectedFiles=git(root,['ls-files','-z']).split('\0').filter(Boolean).filter(f=>f!==source);
 const protectedHashes=Object.fromEntries(protectedFiles.map(file=>[file,trackedHash(root,file)]));
 const original=fs.readFileSync(safePath(root,source),'utf8');
 let installation=null;
 let installationSha256=null;
 if(installationReceipt){
  installationSha256=fileIdentity(installationReceipt,2*1024*1024).sha256;
  installation=readNativeJson(installationReceipt,2*1024*1024);
  if(fileIdentity(installationReceipt,2*1024*1024).sha256!==installationSha256)throw new Error('Installation receipt changed during admission');
  if(installation.repository!=='thedotmack/claude-mem'||installation.revision!==CLAUDE_MEM_PIN||installation.installCompleted!==true||installation.trackedInputsUnchanged!==true||installation.packageSha256!==digest(fs.readFileSync(safePath(root,'package.json'))))throw new Error('Diagnostic campaign requires a bound completed original-declaration installation');
 }
 const receipt={schemaVersion:1,repository:'thedotmack/claude-mem',upstreamRevision:CLAUDE_MEM_PIN,historicalFix,bunVersion:BUN_VERSION,scope:'Original bun test tests plus preregistered sqlite/search/context/server/routes scopes',qualified:false,collectionCompleted:false,observationCompleted:false,learningImproved:false,superiorityEstablished:false,trials:[],notRun:[],errors:[],dependencyMode:'original-declarations-installed',timingScope:'Native duration is process+JUnit validation; TestLore duration includes full execution discovery, graph, selected execution and serialization. Native changed selector is not yet qualified.'};
 const nativeObservations=[];
 receipt.dependencyInventoryAccepted=installation?.dependencyInventoryAccepted===true;
 receipt.installationReceiptSha256=installationSha256;
 if(!receipt.dependencyInventoryAccepted)receipt.errors.push('dependency-environment-unqualified');
 const save=(name,value)=>fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n');
 const native=(name,scope)=>{
  const report=path.join(output,name+'.xml'),command=['bun','test','./'+scope,'--reporter=junit','--reporter-outfile='+report];
  const start=performance.now(),result=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',timeout:180000,killSignal:'SIGKILL',maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(output,name+'.stdout'),result.stdout||'');fs.writeFileSync(path.join(output,name+'.stderr'),result.stderr||'');
  let parsed,error;try{parsed=bunResults(root,readBunReport(report),{exitCode:result.status});}catch(e){error=e.message;}
  const value={command,exitCode:result.status,signal:result.signal,error:result.error?.message||error,complete:!!parsed&&!result.error&&!result.signal,...parsed,durationMs:Math.round(performance.now()-start)};nativeObservations.push({name,complete:value.complete});save(name,value);return value;
 };
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
 try {
  const version=spawnSync('bun',['--version'],{encoding:'utf8',env});if(version.status!==0||version.stdout.trim()!==BUN_VERSION)throw new Error('Campaign Bun version differs from preregistration');
  const prerequisite={requiredFile:oracle,requiredTitleContains:'same millisecond'};
  save('preregistered-manifest',{...receipt,scopes:['tests','tests/sqlite','tests/worker/search','tests/context','tests/server','tests/worker/http/routes'],regressionPrerequisite:{scope:'tests/worker/http/routes',...prerequisite},timeBudget:{deadlineMs:36*60*1000,armTimeoutMs:180000,reportingReserveMs:60000,reservedArms:['native-fault','testlore-discovery','testlore-execution','native-restoration']},oracle,oracleSha256:digest(fs.readFileSync(safePath(root,oracle))),sourceSha256:digest(original),protectedHashes,isolatedHome:true,credentialsInherited:false});
  let routeBaseline;
  receipt.baselines=[];
  for(const scope of ['tests','tests/sqlite','tests/worker/search','tests/context','tests/server','tests/worker/http/routes']){
   const name='baseline-'+scope.replaceAll('/','-'),result=native(name,scope);
   const admission=bunBaselineAdmission(result);
   receipt.baselines.push({scope,report:name+'.json',admission,complete:result.complete,exitCode:result.exitCode});
   if(!admission.admitted)receipt.errors.push(name+':baseline-rejected');
   if(scope==='tests/worker/http/routes')routeBaseline=result;
  }
  receipt.regressionAdmission=bunBaselineAdmission(routeBaseline,prerequisite);
  if(!receipt.regressionAdmission.admitted){
   receipt.notRun=[0,1,2].map(repetition=>({repetition,stage:'fault-full-and-testlore',reason:'original-route-baseline-rejected',evidence:receipt.regressionAdmission.reasons}));
   receipt.notRun.push({stage:'restored-oracle',reason:'no-fault-applied'});
   receipt.collectionCompleted=true;
   return receipt;
  }
  const anchor='store.getUserPromptById(savedUserPromptId)';if(original.split(anchor).length!==2)throw new Error('Historical bug reconstruction precondition changed');
  // Restore the documented newest-by-timestamp mistake while leaving every
  // original upstream test unchanged. This is a bounded bug reconstruction,
  // explicitly not an exact historical full-tree revert.
  const faulty=original.replace(anchor,`store.getUserPromptById((store.db.prepare('SELECT id FROM user_prompts WHERE session_db_id = ? ORDER BY created_at_epoch DESC LIMIT 1').get(sessionDbId) as {id:number}).id)`);
  let faultApplied=false;
  for(let repetition=0;repetition<3;repetition++){
   const budget=bunTrialBudget(performance.now()-campaignStarted);
   if(!budget.admitted){
    for(let remaining=repetition;remaining<3;remaining++)receipt.notRun.push({repetition:remaining,stage:'fault-full-and-testlore',reason:budget.reason,timeBudget:budget});
    receipt.errors.push('campaign-trial-budget-rejected');break;
   }
   fs.writeFileSync(safePath(root,source),faulty);
   faultApplied=true;
   const full=native('regression-'+repetition,'tests/worker/http/routes');
   const independentFailures=(full.tests||[]).filter(t=>t.status==='failed'&&t.file===oracle&&t.title?.includes('same millisecond'));
   if(full.complete!==true||full.exitCode!==1||independentFailures.length!==1){
    receipt.trials.push({repetition,stage:'native-fault-oracle',complete:full.complete,valid:false,independentOracleFailures:independentFailures.length,nativeMs:full.durationMs,error:'independent-fault-oracle-rejected'});
    receipt.notRun.push({repetition,stage:'testlore',reason:'independent-fault-oracle-rejected'});
    for(let remaining=repetition+1;remaining<3;remaining++)receipt.notRun.push({repetition:remaining,stage:'fault-full-and-testlore',reason:'prior-scope-prerequisite-rejected'});
    fs.writeFileSync(safePath(root,source),original);
    break;
   }
   const configFile=path.join(root,'tddswarm.config.json');
   const config={adapter:'bun',runner:['bun','test','{files}'],discovery:'native',bunScope:['tests/worker/http/routes'],testMatch:['tests/worker/http/routes/**/*.test.ts'],runnerTimeoutMs:180000};
   fs.writeFileSync(configFile,JSON.stringify(config));
   let selected,error;const started=performance.now();
   try{selected=run(root,{capture:true,selective:true});save('testlore-'+repetition,selected);}catch(e){error=e.message;}
   finally{fs.rmSync(configFile,{force:true});}
   const durationMs=Math.round(performance.now()-started);
   // Native reports have no TestLore ids: compare exact source/title contracts.
   const key=t=>JSON.stringify([t.file,t.name,t.line||0,t.column||0]);
   const fullCases=(full.tests||[]).map(t=>({...t,id:digest(key(t))}));
   const subsetCases=(selected?.tests||[]).map(t=>({...t,id:digest(key(t))}));
   const preservation=compareSubsetCases({...full,tests:fullCases},{complete:selected?.complete,tests:subsetCases},selected?.executedTests||[]);
   const failures=fullCases.filter(t=>t.status==='failed');
   const preserved=new Set(subsetCases.filter(t=>t.status==='failed').map(t=>t.id));
   const targetFailures=failures.filter(t=>t.file===oracle&&t.title?.includes('same millisecond'));
   const trial={repetition,complete:full.complete&&selected?.complete===true,casePreservation:preservation,independentOracleFailures:targetFailures.length,missedFailures:failures.filter(t=>!preserved.has(t.id)).length,selectedFiles:selected?.plan?.selected?.length,totalFiles:selected?.plan?.total,mode:selected?.plan?.mode,nativeMs:full.durationMs,testLoreMs:durationMs,error};
   trial.valid=trial.complete&&preservation.complete&&targetFailures.length>0&&trial.missedFailures===0;receipt.trials.push(trial);
   fs.writeFileSync(safePath(root,source),original);
   if(!trial.complete){for(let remaining=repetition+1;remaining<3;remaining++)receipt.notRun.push({repetition:remaining,stage:'fault-full-and-testlore',reason:'prior-testlore-scope-incomplete'});break;}
  }
  if(faultApplied){const restored=native('restored-oracle','tests/worker/http/routes');if(!restored.complete||restored.exitCode!==0)receipt.errors.push('restored-oracle-rejected');}
  else receipt.notRun.push({stage:'restored-oracle',reason:'no-fault-applied'});
  receipt.collectionCompleted=true;
 }catch(error){receipt.errors.push(error.message);}
 finally{
  try {
  fs.writeFileSync(safePath(root,source),original);
  receipt.protectedInputsUnchanged=Object.entries(protectedHashes).every(([file,hash])=>trackedHash(root,file)===hash);
  receipt.observationCompleted=receipt.protectedInputsUnchanged&&nativeObservations.length===10&&nativeObservations.every(v=>v.complete)&&receipt.trials.length===3&&receipt.trials.every(t=>t.complete);
  receipt.nativeObservations=nativeObservations;
  receipt.qualified=!receipt.errors.length&&receipt.protectedInputsUnchanged&&receipt.trials.length===3&&receipt.trials.every(t=>t.valid);
  receipt.speedAdvantage=receipt.qualified&&receipt.trials.every(t=>t.testLoreMs<t.nativeMs);
  save('assessment',receipt);
  }finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,oldEnv);}
 }
 return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(![3,4].includes(args.length))throw new Error('Usage: node scripts/claude-mem-public-pilot.js DISPOSABLE_CHECKOUT NEW_EVIDENCE_DIRECTORY ISOLATED_HOME [INSTALLATION_RECEIPT]');
 const result=claudeMemPilot({root:args[0],output:args[1],home:args[2],installationReceipt:args[3]});console.log(JSON.stringify(result,null,2));process.exitCode=result.qualified?0:3;
}
