import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {git,readConfig,safePath,listFiles} from './files.js';
import {snapshot,freshness,digest} from './provenance.js';
import {discover,execute,adapterFor} from './execution.js';
import {stageRepair,validateRepair,applyRepair,isRepairSourcePath,captureRepairState} from './repair-candidates.js';
import {proposeRepair} from './repair-swarm.js';

function changes(root){
 const entries=git(root,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0').filter(Boolean),result=[];
 for(let i=0;i<entries.length;i++){const status=entries[i].slice(0,2);result.push({status,file:entries[i].slice(3)});if(/[RC]/.test(status))result.push({status,file:entries[++i]});}
 return result;
}
const metadata=(row,prefix='')=>row.status==='??'&&['.tddswarm','node_modules'].some(dir=>{const local=prefix&&row.file.startsWith(prefix+'/')?row.file.slice(prefix.length+1):row.file;return local===dir||local.startsWith(dir+'/');});
const clean=(root,prefix)=>changes(root).filter(row=>!metadata(row,prefix));
const inputs=root=>digest(Object.fromEntries(listFiles(root).map(file=>[file,digest(fs.readFileSync(safePath(root,file)))])));
export function repairFullSuite(root,{timeoutMs=120000}={}){
 const config=readConfig(root),discovery=discover(root,{...config,runnerTimeoutMs:timeoutMs,discovery:Array.isArray(config.discovery)?config.discovery:'native'});
 if(!discovery.complete||!discovery.files.length)return {exitCode:2,complete:false,tests:[],discovery,error:'Full native scope is incomplete or empty'};
 return {...execute(root,discovery.files,config,{capture:true,timeoutMs}),discovery};
}
const inventory=tests=>tests.map(test=>JSON.stringify([test.file,test.name,test.project||null])).sort();
function boundInteger(value,fallback,max,label){const number=value??fallback;if(!Number.isSafeInteger(number)||number<1||number>max)throw new Error(`${label} must be an integer from 1 to ${max}`);return number;}

/** A single bounded repair round. Agents propose; only the controller writes. */
export async function repair(root,options={}){
 root=fs.realpathSync(path.resolve(root));
 if(options.worktree!==undefined||options.branch!==undefined)throw new Error('Repair branches and worktree paths are generated');
 const config=readConfig(root);
 if(config.integration||adapterFor(config)!=='node')return {kind:'source-repair',status:'unsupported-repair-evidence',published:false,merged:false,next:['Source repair currently requires Node named assertion evidence. Keep native framework verification enabled.']};
 const deadlineMs=boundInteger(options.deadlineMs,900000,900000,'deadlineMs'),timeoutMs=boundInteger(options.timeoutMs,120000,120000,'timeoutMs');
 const deadline=performance.now()+deadlineMs;
 const remaining=()=>{const value=Math.floor(deadline-performance.now());if(value<1)throw new Error('Repair campaign deadline exhausted');return value;};
 const repository=fs.realpathSync(git(root,['rev-parse','--show-toplevel']).trim()),prefix=path.relative(repository,root).split(path.sep).join('/');
 if(prefix.startsWith('../')||clean(repository,prefix).length)throw new Error('Commit or stash project changes before repair; the original checkout is preserved');
 const requirementsFile=safePath(root,'tddswarm.requirements.md');
 if(!fs.existsSync(requirementsFile)||fs.statSync(requirementsFile).size>65536)return {kind:'source-repair',status:'awaiting-requirements',published:false,merged:false,next:['Commit independent behavior requirements in tddswarm.requirements.md (at most 64 KiB).']};
 const requirements=fs.readFileSync(requirementsFile,'utf8');
 if(!requirements.trim())throw new Error('Independent requirements must be nonempty');
 const sourcePaths=options.sourcePaths??config.repair?.sourcePaths??listFiles(root).filter(file=>/^(?:src|lib|app)\//.test(file)&&isRepairSourcePath(file));
 if(!Array.isArray(sourcePaths)||!sourcePaths.length||sourcePaths.length>32||new Set(sourcePaths).size!==sourcePaths.length||sourcePaths.some(file=>!isRepairSourcePath(file)))throw new Error('Repair requires 1–32 distinct existing production source paths; configure repair.sourcePaths or --sources');
 for(const file of sourcePaths){const stat=fs.statSync(safePath(root,file));if(!stat.isFile()||stat.size>65536)throw new Error(`Unbounded repair source: ${file}`);}
 const before=snapshot(root,config),originalState=captureRepairState(root,{deadline:performance.now()+remaining()}),base=git(repository,['rev-parse','--verify','HEAD^{commit}']).trim();
 let baseBranch=null;try{baseBranch=git(repository,['symbolic-ref','--short','HEAD']).trim();}catch{}
 const id=randomUUID(),branch=`tddswarm/repair-${id}`,worktreeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-repair-')),worktree=prefix?path.join(worktreeRoot,prefix):worktreeRoot;
 const result={schemaVersion:1,kind:'source-repair',id,branch,worktreeRoot,worktree,originalCheckout:root,sourceHead:base,base,baseBranch,sha:null,status:'preparing',published:false,merged:false,budget:{deadlineMs,timeoutMs,maxTasks:3,maxFiles:3,maxPatchBytes:65536,maxRounds:1},sourcePaths};
 const receipt=()=>{const directory=safePath(worktree,'.tddswarm/repair');fs.mkdirSync(directory,{recursive:true});result.receipt=path.join(directory,'result.json');fs.writeFileSync(result.receipt,JSON.stringify(result,null,2));return result;};
 try{
  git(repository,['worktree','add','-b',branch,worktreeRoot,base]);
  const dependencies=path.join(root,'node_modules');if(fs.existsSync(dependencies)&&!fs.existsSync(path.join(worktree,'node_modules')))fs.symlinkSync(fs.realpathSync(dependencies),path.join(worktree,'node_modules'),'dir');
  if(!freshness(before,snapshot(worktree,readConfig(worktree))).fresh)throw new Error('Repair branch inputs differ from caller inputs');
  const branchState=captureRepairState(worktree,{deadline:performance.now()+remaining()});
  if(branchState.scope.fingerprint!==originalState.scope.fingerprint||branchState.dependencies.fingerprint!==originalState.dependencies.fingerprint)throw new Error('Repair branch does not contain the caller’s exact runtime inputs, including ignored files');
  const baseline=repairFullSuite(worktree,{timeoutMs:Math.min(timeoutMs,remaining())});result.detection=baseline;
  if(!baseline.complete||baseline.exitCode!==1||!baseline.tests.some(test=>test.status==='failed')){result.status=baseline.complete&&baseline.exitCode===0?'no-failures':'baseline-incomplete';return receipt();}
  const agent=options.agent??config.agent;
  if(!options.patch&&!agent){result.status='awaiting-agent';result.next=['Configure a bounded JSON worker in agent argv, or install and authenticate the supported Codex CLI.'];return receipt();}
  const proposal=options.patch??await proposeRepair(worktree,{agent,sourcePaths,requirements,baseline,timeoutMs:Math.min(timeoutMs,remaining()),deadlineMs:remaining(),maxTasks:3});
  result.workers=options.patch?{mode:'supplied-reviewed-patch',realAgentExecution:false}:proposal;
  if(!proposal.review?.accepted||!options.patch&&proposal.accepted!==true){result.status='review-rejected';return receipt();}
  // The caller-owned requirements and scope cannot be replaced by worker output.
  const staged=stageRepair(worktree,{files:proposal.files,requirements,sourcePaths,review:proposal.review});result.candidate=staged;result.files=proposal.files.map(file=>file.path);
  result.validation=validateRepair(worktree,staged.candidatePath,{timeoutMs:Math.min(timeoutMs,remaining()),totalTimeoutMs:Math.min(600000,remaining())});
  if(!result.validation.accepted){result.status='validation-rejected';return receipt();}
  result.application=applyRepair(worktree,staged.candidatePath);
  const tested=snapshot(worktree,readConfig(worktree)),testedInputs=inputs(worktreeRoot),testedState=captureRepairState(worktree,{deadline:performance.now()+remaining()});
  result.fullRun=repairFullSuite(worktree,{timeoutMs:Math.min(timeoutMs,remaining())});
  const final=result.fullRun,expected=result.validation.candidate?.tests;
  if(!final.complete||final.exitCode!==0||!final.tests.some(test=>test.status==='passed')||!expected||JSON.stringify(inventory(expected))!==JSON.stringify(inventory(final.tests))){result.status='full-run-failed';return receipt();}
  const afterRun=captureRepairState(worktree,{deadline:performance.now()+remaining()}),callerState=captureRepairState(root,{deadline:performance.now()+remaining()});
  if(inputs(worktreeRoot)!==testedInputs||!freshness(tested,snapshot(worktree,readConfig(worktree))).fresh||afterRun.scope.fingerprint!==testedState.scope.fingerprint||afterRun.dependencies.fingerprint!==testedState.dependencies.fingerprint)throw new Error('Repository or dependencies changed during final repair validation');
  if(git(repository,['rev-parse','HEAD']).trim()!==base||clean(repository,prefix).length||!freshness(before,snapshot(root,readConfig(root))).fresh||callerState.scope.fingerprint!==originalState.scope.fingerprint||callerState.dependencies.fingerprint!==originalState.dependencies.fingerprint)throw new Error('Original checkout changed during repair');
  const allowed=new Set(proposal.files.map(file=>prefix?`${prefix}/${file.path}`:file.path));
  if(changes(worktreeRoot).some(row=>!metadata(row,prefix)&&!allowed.has(row.file)))throw new Error('Changes outside reviewed source repair');
  git(worktreeRoot,['add','--',...allowed]);
  const intendedTree=git(worktreeRoot,['write-tree']).trim();
  git(worktreeRoot,['commit','-m','fix: repair demonstrated assertions with TestLore evidence']);
  result.sha=git(worktreeRoot,['rev-parse','HEAD']).trim();
  const committedState=captureRepairState(worktree,{deadline:performance.now()+remaining()});
  const matches=git(worktreeRoot,['rev-parse','HEAD^{tree}']).trim()===intendedTree&&inputs(worktreeRoot)===testedInputs&&!clean(worktreeRoot,prefix).length&&freshness(tested,snapshot(worktree,readConfig(worktree))).fresh&&committedState.scope.fingerprint===testedState.scope.fingerprint&&committedState.dependencies.fingerprint===testedState.dependencies.fingerprint;
  result.status=matches?'ready-for-review':'commit-requires-review';
  if(!matches)result.error='Committed tree differs from exact tested source inputs';
  result.next=['Review the source diff and repeated unchanged assertion outcomes.','The CLI opens a verified GitHub PR unless --local is supplied. No automatic merge.'];
  return receipt();
 }catch(error){result.status='failed';result.error=error.message;if(error.repairSwarm)result.workers=error.repairSwarm;if(fs.existsSync(path.join(worktreeRoot,'.git')))return receipt();fs.rmSync(worktreeRoot,{recursive:true,force:true});return result;}
}
