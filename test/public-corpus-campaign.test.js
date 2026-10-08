import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/provenance.js';
import {fileIdentity} from '../scripts/worker-identity.js';
import {campaignLimits,campaignLimitsForProfile,campaignInstallOptions,validatePortableProfile,parseCampaignArguments,campaignEnvironment,phaseCompletionReason,runCampaign} from '../scripts/public-corpus-campaign.js';
import {boundedInstallProcess} from '../scripts/public-corpus-upstream.js';

const repository=fileURLToPath(new URL('../',import.meta.url));
const selectionPath=path.join(repository,'benchmarks/public-corpus/preregistration-20261006.json');
const selection=JSON.parse(fs.readFileSync(selectionPath));
const profilePath=path.join(repository,'benchmarks/public-corpus/profiles/unjs-unctx-1bb220dccf40-campaign.json');
const profile=JSON.parse(fs.readFileSync(profilePath));
const receipt=()=>({exitCode:0,reason:null,durationMs:10,stdoutSha256:digest(''),stderrSha256:digest(''),finalResources:{availableBytes:3*1024**3,growthBytes:0,stdoutBytes:0,stderrBytes:0}});
function plan(t){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-campaign-source-test-')),directory=path.join(parent,'fresh');
 const relative='.tddswarm/public-campaigns/source-test-'+path.basename(parent);
 t.after(()=>{fs.rmSync(parent,{recursive:true,force:true});fs.rmSync(path.join(repository,relative),{recursive:true,force:true});});
 const revision=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 return {schemaVersion:1,kind:'original-upstream-campaign-plan',execute:false,candidateId:profile.candidateId,selectionPath,profilePath,profile,selectionCommitmentSha256:selection.commitmentSha256,directory,relative,limits:campaignLimits,binding:{sourceRevision:revision,files:[fileIdentity(selectionPath,16*1024**2)],core:{}},automaticRetries:0};
}
test('portable profiles bind frozen commits, exact manager and original lock; arbitrary config and evidence names are rejected',()=>{
 assert.equal(validatePortableProfile(selection,profile).id,profile.candidateId);
 for(const change of [{fixRevision:'a'.repeat(40)},{packageManager:'pnpm@99.0.0'},{candidateId:'unjs-unctx-other'},{config:{env:{TOKEN:'secret'}}},{expectedFailureNames:['inferred-title']}])assert.throws(()=>validatePortableProfile(selection,{...profile,...change}));
 assert.throws(()=>validatePortableProfile(selection,{...profile,dependencySha256:{...profile.dependencySha256,'pnpm-lock.yaml':'0'.repeat(64)}}),/manifest\/lock/);
 assert.throws(()=>validatePortableProfile(selection,{...profile,scope:'x'.repeat(201)}),/closed reviewed/);
 assert.throws(()=>validatePortableProfile(selection,{...profile,scope:'   '}),/closed reviewed/);
 assert.throws(()=>validatePortableProfile(selection,{...profile,executionMode:'unified-native'}),/execution mode/);
 const ufo=JSON.parse(fs.readFileSync(path.join(repository,'benchmarks/public-corpus/profiles/unjs-ufo-5cd9e676711a-campaign.json')));
 assert.equal(validatePortableProfile(selection,ufo).id,ufo.candidateId);
 assert.throws(()=>validatePortableProfile(selection,{...ufo,executionMode:'legacy'}),/execution mode/);
 assert.throws(()=>{campaignLimits.phases.install.maxGrowthBytes=Number.MAX_SAFE_INTEGER;},TypeError);
});
test('ordinary CLI requests remain dry plans; explicit opt-in is a closed exact final flag',()=>{
 const args=['--selection','frozen.json','--profile','reviewed.json','--directory','private','--output','.tddswarm/public-campaigns/example'];
 assert.equal(parseCampaignArguments(args).execute,false);
 assert.equal(parseCampaignArguments([...args,'--install-and-execute']).execute,true);
 for(const invalid of [[...args,'--execute'],[...args,'--install-and-execute','--env','TOKEN=secret'],['--worker','install'],[...args.slice(0,4),'--install-and-execute',...args.slice(4)]])assert.throws(()=>parseCampaignArguments(invalid));
});
test('reviewed defu histories bind separate original oracles and reject unsupported native versions or altered scope mode',()=>{
 const profiles=['unjs-defu-11ba02213d4b','unjs-defu-3942bfbbcaa7'].map(id=>JSON.parse(fs.readFileSync(path.join(repository,'benchmarks/public-corpus/profiles/'+id+'-campaign.json'))));
 const candidates=profiles.map(p=>validatePortableProfile(selection,p));assert.notEqual(candidates[0].fixRevision,candidates[1].fixRevision);assert.equal(candidates[0].parentRevision,candidates[1].fixRevision);
 assert.deepEqual(profiles[0].dependencySha256,profiles[1].dependencySha256);assert.equal(profiles[0].packageManager,'pnpm@10.33.0');assert.ok(profiles.every(p=>p.installedVitest==='4.1.2'&&p.executionMode==='legacy'));
 assert.notEqual(candidates[0].byteBindings.find(b=>b.kind==='oracle').sha256,candidates[1].byteBindings.find(b=>b.kind==='oracle').sha256);
 for(const p of profiles){assert.throws(()=>validatePortableProfile(selection,{...p,installedVitest:'0.34.6'}),/native version/);assert.throws(()=>validatePortableProfile(selection,{...p,installedVitest:'4.1.99'}),/native version/);assert.throws(()=>validatePortableProfile(selection,{...p,executionMode:'unified-native'}),/execution mode/);assert.throws(()=>validatePortableProfile(selection,{...p,expectedFailureNames:['invented passing claim']}),/closed reviewed/);}
 const workflow=fs.readFileSync(path.join(repository,'.github/workflows/public-upstream-campaign.yml'),'utf8');assert.match(workflow,/max-parallel: 1/);assert.match(workflow,/defu-both.*defu-inherited.*defu-proto/);for(const p of profiles)assert.ok(workflow.includes(p.candidateId+'-campaign.json'));assert.match(workflow,/workflow_dispatch/);assert.doesNotMatch(workflow,/^\s+schedule:/m);
});
test('campaign child environment strips credential overrides and forwards only the declared cache policy',()=>{
 const previous={...process.env};try{process.env.GITHUB_TOKEN='never-forward';process.env.AWS_SECRET_ACCESS_KEY='never-forward';process.env.NODE_OPTIONS='--require=untrusted.js';process.env.GIT_CONFIG_GLOBAL='/secret/gitconfig';process.env.JITI_FS_CACHE='true';const env=campaignEnvironment();assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.AWS_SECRET_ACCESS_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.JITI_FS_CACHE,'false');assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');assert.equal(env.GIT_CONFIG_NOSYSTEM,'1');assert.equal(env.GIT_TERMINAL_PROMPT,'0');}finally{process.env=previous;}
});
test('only the two bound defu profiles receive a finite installation ceiling; every other guard stays unchanged',()=>{
 for(const id of ['unjs-defu-11ba02213d4b','unjs-defu-3942bfbbcaa7']){
  const p=JSON.parse(fs.readFileSync(path.join(repository,'benchmarks/public-corpus/profiles/'+id+'-campaign.json'))),limits=campaignLimitsForProfile(selection,p);
  assert.equal(limits.phases.install.maxGrowthBytes,768*1024**2);const restored=structuredClone(limits);restored.phases.install.maxGrowthBytes=campaignLimits.phases.install.maxGrowthBytes;assert.deepEqual(restored,campaignLimits);
  assert.throws(()=>{limits.phases.install.maxGrowthBytes=1024**3;},TypeError);assert.throws(()=>validatePortableProfile(selection,{...p,installGrowthPolicy:'default'}),/growth policy/);const missing={...p};delete missing.installGrowthPolicy;assert.throws(()=>validatePortableProfile(selection,missing),/closed reviewed/);
 }
 assert.deepEqual(campaignLimitsForProfile(selection,profile),campaignLimits);assert.throws(()=>validatePortableProfile(selection,{...profile,installGrowthPolicy:'defu-original-lock-768mib'}),/closed reviewed/);
});
test('defu inner and outer installation guards use the reviewed ceiling and retain over-budget rejection',async t=>{
 for(const overflow of [false,true]){
  const input=plan(t);input.profilePath=path.join(repository,'benchmarks/public-corpus/profiles/unjs-defu-11ba02213d4b-campaign.json');input.profile=JSON.parse(fs.readFileSync(input.profilePath));input.candidateId=input.profile.candidateId;input.limits=campaignLimitsForProfile(selection,input.profile);
  assert.deepEqual(campaignInstallOptions(input),{reserveBytes:2*1024**3,timeoutMs:180000,maxGrowthBytes:768*1024**2,growthPolicy:'defu-original-lock-768mib'});
  const tampered={...input,limits:structuredClone(input.limits)};tampered.limits.phases.install.maxGrowthBytes=1024**3;assert.throws(()=>campaignInstallOptions(tampered),/resource limits/);await assert.rejects(()=>runCampaign(tampered),/unchanged dry-run/);
  let phases=[];const result=await runCampaign(input,{availableBytes:()=>3*1024**3,executePhase:async(_command,args,options)=>{const phase=args[2];phases.push(phase);const r=receipt();if(phase==='preflight'){r.exitCode=1;return r;}if(phase==='install'){assert.equal(options.maxGrowthBytes,campaignInstallOptions(input).maxGrowthBytes);assert.equal(options.reserveBytes,2*1024**3);assert.equal(options.timeoutMs,180000);assert.equal(options.maxLogBytes,2*1024**2);r.finalResources.growthBytes=(overflow?769:500)*1024**2;}fs.writeFileSync(path.join(options.directory,'result.json'),'{}');return r;}});
  assert.deepEqual(phases,overflow?['clone','install']:['clone','install','preflight']);assert.equal(result.failedPhase,overflow?'install':'preflight');assert.equal(result.stopReason,overflow?'disk-growth':'phase-rejected');assert.equal(result.qualified,false);assert.equal(result.accounting.qualified,0);assert.equal(result.automaticRetries,0);
 }
});
test('fast nominal zero exits still fail final timeout, reserve, growth and log-budget evidence',()=>{
 const limits=campaignLimits.phases.clone,available=3*1024**3;
 assert.equal(phaseCompletionReason(receipt(),limits,10,available),null);
 const timeout=receipt();timeout.durationMs=limits.timeoutMs+1;assert.equal(phaseCompletionReason(timeout,limits,10,available),'timeout');
 const growth=receipt();growth.finalResources.growthBytes=limits.maxGrowthBytes+1;assert.equal(phaseCompletionReason(growth,limits,10,available),'disk-growth');
 const log=receipt();log.finalResources.stdoutBytes=campaignLimits.maxLogBytes+1;assert.equal(phaseCompletionReason(log,limits,10,available),'log-budget');
 const reserve=receipt();reserve.finalResources.availableBytes=campaignLimits.minFreeBytes-1;assert.equal(phaseCompletionReason(reserve,limits,10,available),'disk-reserve');
 assert.equal(phaseCompletionReason(receipt(),limits,campaignLimits.maxCampaignMs+1,available),'campaign-deadline');
 const missing=receipt();delete missing.finalResources;assert.equal(phaseCompletionReason(missing,limits,10,available),'observation-failed');
 const unhashed=receipt();unhashed.stdoutSha256=null;assert.equal(phaseCompletionReason(unhashed,limits,10,available),'log-identity-unavailable');
});
test('resource rejection retains a scoped blocked outcome without starting even a mocked child',async t=>{
 const input=plan(t);let calls=0;const result=await runCampaign(input,{availableBytes:()=>0,executePhase:async()=>{calls++;throw Error('must not start');}});
 assert.equal(calls,0);assert.equal(fs.existsSync(input.directory),false);assert.equal(result.qualified,false);assert.equal(result.accounting.blocked,1);assert.equal(result.accounting.qualified,0);assert.equal(result.stopReason,'disk-reserve');assert.equal(result.automaticRetries,0);
 await assert.rejects(runCampaign(input,{availableBytes:()=>3*1024**3}),/must be new/);
});
test('a fast over-log child remains a failed phase with receipts and does not advance to installation',async t=>{
 const input=plan(t);let calls=0;const result=await runCampaign(input,{availableBytes:()=>3*1024**3,executePhase:async(command,args,options)=>{calls++;assert.equal(args.at(-1),'--execute');assert.equal(options.terminateDescendants,true);assert.equal(options.env.GITHUB_TOKEN,undefined);const r=receipt();r.finalResources.stdoutBytes=campaignLimits.maxLogBytes+1;return r;}});
 assert.equal(calls,1);assert.equal(result.failedPhase,'clone');assert.equal(result.stopReason,'log-budget');assert.equal(result.qualified,false);
 for(const file of ['started.json','process.json','finished.json'])assert.ok(fs.existsSync(path.join(repository,input.relative,'phases/clone',file)));
 assert.equal(fs.existsSync(path.join(repository,input.relative,'phases/install')),false);
});
test('mutating execution input fails a nominal child and preserves the distinct drift phase reason',async t=>{
 const input=plan(t);let calls=0;const result=await runCampaign(input,{availableBytes:()=>3*1024**3,executePhase:async()=>{calls++;fs.appendFileSync(path.join(repository,input.relative,'plan.json'),' ');return receipt();}});
 assert.equal(calls,1);assert.equal(result.qualified,false);assert.equal(result.phases[0].reason,'execution-input-drift');assert.equal(result.accounting.partial,1);
});
test('a nominal parent exit with an observed live detached child is rejected and the child is terminated',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-descendant-source-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const script="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();console.log(child.pid);setTimeout(()=>process.exit(0),500);";
 let pid=null;try{const result=await boundedInstallProcess(process.execPath,['-e',script],{cwd:directory,directory,reserveBytes:0,maxGrowthBytes:8*1024**2,timeoutMs:3000,terminateDescendants:true,env:campaignEnvironment()});pid=Number(fs.readFileSync(path.join(directory,'stdout.log'),'utf8').trim());assert.ok(Number.isInteger(pid)&&pid>0);assert.equal(result.exitCode,0);assert.equal(result.reason,'surviving-descendants');assert.ok(result.descendantCleanup.observed>=1);assert.ok(result.descendantCleanup.survivingAtClose>=1);assert.equal(result.descendantCleanup.requested,true);assert.equal(phaseCompletionReason(result,campaignLimits.phases.clone,10,3*1024**3),'surviving-descendants');
  let live=true;for(let repeat=0;repeat<20&&live;repeat++){try{const state=execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();live=!!state&&!state.includes('Z');}catch{live=false;}if(live)await new Promise(resolve=>setTimeout(resolve,25));}assert.equal(live,false,'observed detached child still alive after cleanup');
 }finally{if(pid){try{process.kill(-pid,'SIGKILL');}catch{}try{process.kill(pid,'SIGKILL');}catch{}}}
});
