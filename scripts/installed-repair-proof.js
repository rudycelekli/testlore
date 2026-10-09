import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const hash=value=>createHash('sha256').update(value).digest('hex');
const requirements='Module a must export integer 1; module b must preserve integer 2. Original assertions and requirements must remain unchanged.';
const originals={
 'src/a.js':'export const a=9;',
 'src/b.js':'export const b=2;',
 'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('independent required a value',()=>assert.equal(a,1));",
 'test/b.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {b} from '../src/b.js';test('unchanged required b value',()=>assert.equal(b,2));"
};
const summary=run=>({complete:run.complete,exitCode:run.exitCode,files:[...(run.collectionFiles||[])].sort(),cases:(run.tests||[]).map(test=>({file:test.file,name:test.name,status:test.status})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
const rawNames=['oracle-edit.json','oracle-edit.requests.jsonl','successful.json','successful.requests.jsonl','wrong-source.json','wrong-source.requests.jsonl'];
function rawIndexComplete(index){return Array.isArray(index)&&index.length===6&&JSON.stringify(index.map(item=>item?.file).sort())===JSON.stringify(rawNames)&&index.every(item=>Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=2*1024*1024&&typeof item.sha256==='string'&&/^[a-f0-9]{64}$/.test(item.sha256));}

/** Recheck persisted raw subprocess evidence before publishing the same archive. */
export function verifyInstalledRepairRawEvidence(directory,evidence){
 if(!rawIndexComplete(evidence?.rawEvidence))throw Error('Installed repair raw evidence index incomplete');
 for(const binding of evidence.rawEvidence){
  const file=path.join(directory,binding.file),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  try{
   const st=fs.fstatSync(fd);if(!st.isFile()||st.size!==binding.bytes)throw Error('Installed repair raw evidence size changed');
   const content=Buffer.alloc(st.size+1);let offset=0;while(offset<content.length){const count=fs.readSync(fd,content,offset,content.length-offset,null);if(!count)break;offset+=count;}
   const after=fs.fstatSync(fd),named=fs.lstatSync(file);
   if(offset!==st.size||st.size!==after.size||st.mtimeMs!==after.mtimeMs||st.ctimeMs!==after.ctimeMs||!named.isFile()||st.dev!==named.dev||st.ino!==named.ino||hash(content.subarray(0,offset))!==binding.sha256)throw Error('Installed repair raw evidence changed');
  }finally{fs.closeSync(fd);}
 }
 return true;
}

/** Acceptance is deliberately limited to native validation and deterministic transport. */
export function installedRepairEvidenceComplete(value){
 const sha=n=>typeof n==='string'&&/^[a-f0-9]{40}$/.test(n);
 const digest=n=>typeof n==='string'&&/^[a-f0-9]{64}$/.test(n);
 const full=(run,failed)=>run?.complete===true&&run.exitCode===(failed?1:0)&&Array.isArray(run.cases)&&run.cases.length===2&&JSON.stringify(run.cases.map(t=>t&&[t.file,t.name,t.status]).sort())===JSON.stringify([['test/a.test.js','independent required a value',failed?'failed':'passed'],['test/b.test.js','unchanged required b value','passed']])&&JSON.stringify(run.files)==='["test/a.test.js","test/b.test.js"]';
 return value?.qualified===true&&value.mode==='installed-cli-deterministic-worker'&&value.productionInstalled===true&&value.realModelProvider===false&&value.liveGitHub===false&&value.modelCost===null&&value.status==='ready-for-review'&&value.published===false&&value.merged===false&&value.omitted===0&&value.originalCallerUnchanged===true&&value.originalAssertionsUnchanged===true&&value.exactCommitVerified===true&&sha(value.sourceHead)&&sha(value.sha)&&value.sha!==value.sourceHead&&/^tddswarm\/repair-[a-zA-Z0-9_-]+$/.test(value.branch)&&digest(value.installedManifestSha256)&&digest(value.archiveSha256)&&digest(value.proofScriptSha256)&&rawIndexComplete(value.rawEvidence)&&value.workers?.completedCalls===3&&value.workers?.executionValidated===false&&Array.isArray(value.baseline)&&value.baseline.length===2&&value.baseline.every(r=>full(r,true))&&Array.isArray(value.candidateRuns)&&value.candidateRuns.length===2&&value.candidateRuns.every(r=>full(r,false))&&value.assertionRuns===2&&full(value.finalRun,false)&&value.wrongSource?.rejected===true&&value.wrongSource.sha===null&&value.wrongSource.published===false&&value.oracleEdit?.rejected===true&&value.oracleEdit.sha===null&&value.oracleEdit.published===false;
}

/** Called only after the packed proof has installed its sealed production archive. */
export function installedRepairProof({workspace,cli,packageRoot,archiveSha256,sourceRevision,evidenceDirectory}){
 assert.ok(evidenceDirectory,'Installed qualification must preserve native subprocess evidence');
 const installed=fs.realpathSync(packageRoot),manifest=fs.readFileSync(path.join(installed,'package.json'));
 const metadata=JSON.parse(manifest);assert.equal(metadata.name,'testlore');
 assert.equal(path.basename(installed),'testlore');assert.equal(path.basename(path.dirname(installed)),'node_modules');
 assert.equal(fs.realpathSync(cli),path.join(installed,'src/cli.js'));
 assert.ok(/^[a-f0-9]{64}$/.test(archiveSha256));
 if(sourceRevision)assert.equal(metadata.gitHead,sourceRevision);
 const tools=path.join(workspace,'repair-worker-tools');fs.mkdirSync(tools,{recursive:true});
 const home=path.join(tools,'home');fs.mkdirSync(home);
 const env={PATH:process.env.PATH,HOME:home,TMPDIR:process.env.TMPDIR||'/tmp',CI:'true'};
 // This executable is outside every repository and cannot change their tracked inputs.
 const worker=path.join(tools,'worker.cjs');
 fs.writeFileSync(worker,`const fs=require('fs'),path=require('path');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const p=JSON.parse(input),mode=process.argv[2],review={accepted:true,findings:[],oracle:{independent:true,basis:[p.requirements]}};fs.appendFileSync(path.join(__dirname,mode+'.requests.jsonl'),JSON.stringify({role:p.role,sourcePaths:p.sourcePaths||null,baselineFailures:p.baselineFailures})+'\\n');const response=p.role==='repair-architect'?{tasks:[{subject:'src/a.js',instructions:'Restore the independent public contract.'}]}:p.role==='repair-author'?{files:[{path:mode==='oracle-edit'?'test/a.test.js':'src/a.js',content:mode==='oracle-edit'?"import test from 'node:test';test('independent required a value',()=>{});":mode==='wrong-source'?'export const a=99;':'export const a=1;'}]}:review;process.stdout.write(JSON.stringify(response));});`);
 const invoke=(cwd,argv,expected=0)=>{const run=spawnSync(argv[0],argv.slice(1),{cwd,env,shell:false,encoding:'utf8',timeout:45000,killSignal:'SIGKILL',maxBuffer:16*1024*1024});assert.equal(run.error,undefined,run.error?.message);assert.equal(run.status,expected,run.stderr+'\n'+run.stdout);return run.stdout;};
 const git=(cwd,...args)=>invoke(cwd,['git',...args]).trim();
 const projects=[],results={};
 try{
  for(const mode of ['successful','wrong-source','oracle-edit']){
   const project=path.join(workspace,'repair-'+mode);fs.mkdirSync(project);projects.push(project);
   const files={...originals,'package.json':JSON.stringify({type:'module'}),'.gitignore':'.tddswarm/\n','tddswarm.requirements.md':requirements,'tddswarm.config.json':JSON.stringify({adapter:'node',discovery:'native',executionMode:'shadow',runner:[process.execPath,'--test','{files}'],agent:[process.execPath,worker,mode],repair:{sourcePaths:['src/a.js']}})};
   for(const [file,content]of Object.entries(files)){const target=path.join(project,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
   for(const args of [['init','-b','main'],['config','user.name','Installed Repair Proof'],['config','user.email','proof@example.invalid'],['config','commit.gpgsign','false'],['config','core.hooksPath',tools],['add','.'],['commit','-m','Independent failing source contract']])git(project,...args);
   const sourceHead=git(project,'rev-parse','HEAD'),originalHashes=Object.fromEntries(Object.keys(files).map(file=>[file,hash(fs.readFileSync(path.join(project,file)))]));
   const output=invoke(project,[process.execPath,cli,'autopilot','--root',project,'--sources','src/a.js','--deadline-ms','25000','--local','--json'],mode==='successful'?0:2),result=JSON.parse(output);results[mode]=result;
   if(evidenceDirectory){fs.mkdirSync(evidenceDirectory,{recursive:true});fs.writeFileSync(path.join(evidenceDirectory,mode+'.json'),output,{flag:'wx'});}
   assert.equal(git(project,'rev-parse','HEAD'),sourceHead);assert.equal(git(project,'branch','--show-current'),'main');assert.equal(git(project,'status','--porcelain'),'');
   for(const [file,digest]of Object.entries(originalHashes))assert.equal(hash(fs.readFileSync(path.join(project,file))),digest,'Original caller changed: '+file);
   assert.equal(result.published,false);assert.equal(result.merged,false);
   if(mode==='successful'){
    assert.equal(result.status,'ready-for-review');assert.equal(result.kind,'source-repair');assert.equal(result.validation.accepted,true);assert.equal(result.sourceHead,sourceHead);
    assert.equal(git(result.worktree,'rev-parse','HEAD'),result.sha);assert.equal(git(project,'rev-parse','refs/heads/'+result.branch),result.sha);
    assert.equal(git(result.worktree,'diff','--name-only',sourceHead,result.sha),'src/a.js');assert.equal(git(result.worktree,'show',result.sha+':src/a.js'),'export const a=1;');
    for(const file of ['test/a.test.js','test/b.test.js','tddswarm.requirements.md'])assert.equal(hash(fs.readFileSync(path.join(result.worktree,file))),originalHashes[file]);
    assert.equal(result.validation.baseline.length,2);assert.equal(result.validation.candidateRuns.length,2);assert.equal(result.validation.assertionRuns.length,2);
    assert.equal(result.fullRun.complete,true);assert.equal(result.fullRun.exitCode,0);
   }else{assert.equal(result.sha,null);assert.notEqual(result.status,'ready-for-review');assert.equal(git(result.worktree,'rev-parse','HEAD'),sourceHead);}
  }
  const accepted=results.successful;
  const evidence={schemaVersion:1,qualified:true,mode:'installed-cli-deterministic-worker',productionInstalled:true,realModelProvider:false,liveGitHub:false,modelCost:null,status:accepted.status,published:accepted.published,merged:accepted.merged,omitted:0,sourceHead:accepted.sourceHead,sha:accepted.sha,branch:accepted.branch,installedManifestSha256:hash(manifest),archiveSha256,proofScriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),originalCallerUnchanged:true,originalAssertionsUnchanged:true,exactCommitVerified:true,workers:{completedCalls:accepted.workers.completedCalls,executionValidated:accepted.workers.executionValidated},baseline:accepted.validation.baseline.map(summary),candidateRuns:accepted.validation.candidateRuns.map(summary),assertionRuns:accepted.validation.assertionRuns.length,finalRun:summary(accepted.fullRun),wrongSource:{rejected:results['wrong-source'].status==='validation-rejected',status:results['wrong-source'].status,sha:results['wrong-source'].sha,published:results['wrong-source'].published},oracleEdit:{rejected:results['oracle-edit'].status==='failed',status:results['oracle-edit'].status,sha:results['oracle-edit'].sha,published:results['oracle-edit'].published},limitations:['Three controlled immutable Node contract fixtures. Real model quality, model cost, broad framework compatibility and live PR publication are not measured.','Deterministic workers propose known fixture repairs; the controller independently verifies named native assertions.']};
  for(const mode of Object.keys(results))fs.copyFileSync(path.join(tools,mode+'.requests.jsonl'),path.join(evidenceDirectory,mode+'.requests.jsonl'));
  evidence.rawEvidence=rawNames.map(file=>{const content=fs.readFileSync(path.join(evidenceDirectory,file));return {file,bytes:content.length,sha256:hash(content)};});
  assert.equal(installedRepairEvidenceComplete(evidence),true,'Installed repair evidence incomplete');
  verifyInstalledRepairRawEvidence(evidenceDirectory,evidence);
  return evidence;
 }finally{
  for(const project of projects){try{const listing=git(project,'worktree','list','--porcelain');for(const line of listing.split('\n'))if(line.startsWith('worktree ')){const worktree=line.slice(9);if(worktree!==project)git(project,'worktree','remove','--force',worktree);}}catch{}}
 }
}
