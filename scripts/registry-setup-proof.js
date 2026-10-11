#!/usr/bin/env node
// Qualify the documented registry-version command after exact archive verification.
// No login, publication, provider call or implicit version/tag substitution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {summarizeFirstRun} from '../src/run-report.js';
import {boundedInstallProcess} from './public-corpus-upstream.js';
import {fileIdentity} from './worker-identity.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const profiles=['default','disabled','negative'];
const rawNames=['registry-proof.json','installed-manifest.json','installed-cli.js','preregistration.json',...profiles.flatMap(name=>[`${name}-stdout.json`,`${name}-stderr.log`,`${name}-process.json`,`${name}-config.json`])].sort();
const rows=failed=>[['test/a.test.js','registry a','passed'],['test/b.test.js','registry b',failed?'failed':'passed']];

export function registrySetupCaptureComplete(result,negative=false){
 try {
  const run=result.verification;
  assert.equal(result.executionMode,'shadow');assert.equal(result.agent.executed,false);
  assert.equal(run.adapter,'node');assert.equal(run.executed,true);assert.equal(run.complete,true);assert.equal(run.shadow,true);
  assert.equal(run.exitCode,negative?1:0);assert.ok(!run.signal&&!run.error);
  assert.ok(!run.reportErrors||Array.isArray(run.reportErrors)&&run.reportErrors.length===0);
  assert.deepEqual([...run.executedFiles].sort(),['test/a.test.js','test/b.test.js']);
  assert.deepEqual(run.tests.map(test=>[test.file,test.name,test.status]).sort(),rows(negative));
  assert.deepEqual(result.summary,summarizeFirstRun(run));assert.deepEqual(run.summary,result.summary);
  assert.equal(result.summary.verdict,negative?'failed':'passed-in-observed-scope');
  assert.equal(result.summary.files.actualOmissions,0);
  return true;
 } catch {return false;}
}

// Raw replay establishes consistency. Release lineage additionally needs the
// independently verified receipt/producer supplied by the caller.
export function verifyRegistrySetupRaw(directory,evidence,expected={}){
 assert.equal(evidence.schemaVersion,1);assert.equal(evidence.kind,'exact-registry-version-setup');
 assert.match(evidence.version,/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/);
 assert.match(evidence.sourceRevision,/^[a-f0-9]{40}$/);
 for(const key of ['archiveSha256','inputReleaseReceiptSha256','installedManifestSha256','installedCliSha256','producerSha256'])assert.ok(hex(evidence[key]));
 for(const key of ['qualified','isolatedProfiles','freshIsolatedCache','originalAssertionsPreserved','registryArchiveVerified'])assert.equal(evidence[key],true);
 assert.equal(evidence.liveProviders,false);assert.equal(evidence.liveGitHub,false);assert.equal(evidence.modelCost,null);assert.equal(evidence.coldTimingClaim,false);
 for(const [key,value] of Object.entries(expected))assert.equal(evidence[key],value,`Registry setup differs from independent ${key}`);
 assert.deepEqual(evidence.rawEvidence.map(item=>item.file).sort(),rawNames);
 for(const item of evidence.rawEvidence){
  assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=2*1024**2&&hex(item.sha256));
  const file=path.join(directory,item.file),stat=fs.lstatSync(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,item.bytes);assert.equal(fileIdentity(file,2*1024**2).sha256,item.sha256);
 }
 const read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
 const registry=read('registry-proof.json');
 assert.equal(registry.exactBytes,true);for(const key of ['version','sourceRevision','archiveSha256'])assert.equal(registry[key],evidence[key]);
 const preregistration=read('preregistration.json');
 for(const key of ['version','sourceRevision','archiveSha256','inputReleaseReceiptSha256','installedManifestSha256','installedCliSha256'])assert.equal(preregistration[key],evidence[key]);
 assert.deepEqual(preregistration.command,['npm','exec','--yes',`--package=testlore@${evidence.version}`,'--','testlore','setup','--verify','--json']);
 const installed=read('installed-manifest.json');assert.equal(installed.name,'testlore');assert.equal(installed.version,evidence.version);assert.equal(installed.gitHead,evidence.sourceRevision);
 assert.equal(fileIdentity(path.join(directory,'installed-manifest.json'),2*1024**2).sha256,evidence.installedManifestSha256);
 assert.equal(fileIdentity(path.join(directory,'installed-cli.js'),2*1024**2).sha256,evidence.installedCliSha256);
 for(const name of profiles){
  const capture=read(`${name}-stdout.json`),process=read(`${name}-process.json`),config=read(`${name}-config.json`);
  assert.deepEqual(capture,evidence[name]);assert.equal(registrySetupCaptureComplete(capture,name==='negative'),true);
  assert.equal(process.exitCode,name==='negative'?1:0);assert.equal(process.signal,null);assert.equal(process.reason,null);
  assert.ok(!process.error);assert.ok(Number.isFinite(process.durationMs)&&process.durationMs>=0&&process.durationMs<=60000);
  for(const stream of ['stdout','stderr']){
   const filename=`${name}-${stream}.${stream==='stdout'?'json':'log'}`,actual=fileIdentity(path.join(directory,filename),2*1024**2);
   assert.equal(process[`${stream}Sha256`],actual.sha256,'Process receipt must bind its retained native output');
   assert.equal(process.finalResources?.[`${stream}Bytes`],actual.bytes);
  }
  assert.equal(config.adapter,'node');assert.equal(config.executionMode,'shadow');
  if(name==='disabled')for(const id of ['c8','agentic-qe']){assert.deepEqual(config.plugins[id],{enabled:false});assert.equal(capture.plugins.decisions.find(row=>row.id===id)?.action,'retain');}
 }
 return true;
}

export async function registrySetupProof({receipt:receiptFile,output}){
 const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),started=performance.now(),deadline=started+120000;
 const verified=spawnSync(process.execPath,[path.join(sourceRoot,'scripts/release-candidate.js'),'--verify',path.resolve(receiptFile)],{cwd:sourceRoot,encoding:'utf8',shell:false,timeout:30000,maxBuffer:1024*1024});
 assert.equal(verified.status,0,'Require independently verified immutable release source and exact qualified archive');
 const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8')),releaseDirectory=path.dirname(path.resolve(receiptFile));
 const proof=JSON.parse(fs.readFileSync(path.join(releaseDirectory,'packed-proof.json'),'utf8'));
 const registryFile=path.join(releaseDirectory,'registry-proof.json'),registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
 assert.equal(registry.exactBytes,true);for(const key of ['version','sourceRevision','archiveSha256'])assert.equal(registry[key],receipt[key]);
 assert.match(receipt.version,/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/);
 // Rerun metadata/byte comparison rather than trusting a stale registry capture.
 const directory=path.resolve(output);assert.equal(fs.existsSync(directory),false,'Preserve prior evidence: output must be new');fs.mkdirSync(directory,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-registry-setup-'));
 const save=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 try {
  // Bind the exact public archive again; the installed CLI/manifest must also
  // match the independently qualified package, not merely the version string.
  const metadata=spawnSync('npm',['view',`testlore@${receipt.version}`,'dist','--json','--registry=https://registry.npmjs.org'],{encoding:'utf8',shell:false,timeout:15000,maxBuffer:65536});
  assert.equal(metadata.status,0,'Exact registry version must exist');const dist=JSON.parse(metadata.stdout);
  assert.equal(dist.integrity,receipt.npmIntegrity);
  assert.equal(dist.tarball,`https://registry.npmjs.org/testlore/-/testlore-${receipt.version}.tgz`);
  const response=await fetch(dist.tarball,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.ok(response.ok);
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=16*1024**2,'Registry archive exceeds bound');chunks.push(chunk);}
  const archive=Buffer.concat(chunks);assert.equal(hash(archive),receipt.archiveSha256);assert.equal('sha512-'+createHash('sha512').update(archive).digest('base64'),receipt.npmIntegrity);
  save('registry-proof.json',{...registry,date:new Date().toISOString(),registryIntegrity:dist.integrity});
  const binding={version:receipt.version,sourceRevision:receipt.sourceRevision,archiveSha256:receipt.archiveSha256,inputReleaseReceiptSha256:fileIdentity(receiptFile).sha256,installedManifestSha256:proof.oneCommand.installedManifestSha256,installedCliSha256:proof.oneCommand.installedCliSha256};
  const args=['exec','--yes',`--package=testlore@${receipt.version}`,'--','testlore','setup','--verify','--json'];
  save('preregistration.json',{...binding,command:['npm',...args],deadlineMs:120000,reserveBytes:2*1024**3,maxGrowthBytes:300*1024**2,scope:'Controlled Node projects; pass, retained disabled adapters and real native failure. No application routing or efficacy claim.'});
  const home=path.join(workspace,'home'),cache=path.join(workspace,'cache'),temporary=path.join(workspace,'tmp');for(const file of [home,cache,temporary])fs.mkdirSync(file);
  const userConfig=path.join(workspace,'npm-user-config'),globalConfig=path.join(workspace,'npm-global-config');fs.writeFileSync(userConfig,'');fs.writeFileSync(globalConfig,'');
  const env={PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),HOME:home,TMPDIR:temporary,CI:'true',GIT_CONFIG_GLOBAL:userConfig,GIT_CONFIG_NOSYSTEM:'1',npm_config_cache:cache,npm_config_userconfig:userConfig,npm_config_globalconfig:globalConfig,npm_config_ignore_scripts:'true',npm_config_omit:'dev',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'https://registry.npmjs.org/'};
  const results={};
  for(const name of profiles){
   const project=path.join(workspace,name);fs.mkdirSync(project);
   const files={'package.json':JSON.stringify({name:`registry-${name}`,type:'module',scripts:{test:'node --test'}}),'.gitignore':'.tddswarm/\nnode_modules/\n','src/a.js':'export const a=1;','src/b.js':name==='negative'?'export const b=9;':'export const b=2;','test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('registry a',()=>assert.equal(a,1));",'test/b.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {b} from '../src/b.js';test('registry b',()=>assert.equal(b,2));"};
   if(name==='disabled')files['tddswarm.config.json']=JSON.stringify({adapter:'node',discovery:'native',executionMode:'shadow',runner:[process.execPath,'--test','{files}'],plugins:{c8:{enabled:false},'agentic-qe':{enabled:false}}});
   for(const [file,content]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(project,file)),{recursive:true});fs.writeFileSync(path.join(project,file),content);}
   const git=(...argv)=>{const result=spawnSync('git',['-C',project,...argv],{env,encoding:'utf8',shell:false,timeout:10000,maxBuffer:65536});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
   for(const argv of [['init','-b','main'],['config','user.name','Registry Qualification'],['config','user.email','proof@example.invalid'],['config','commit.gpgsign','false'],['add','.'],['commit','-m','Independent registry setup assertions']])git(...argv);
   const head=git('rev-parse','HEAD'),log=path.join(workspace,`${name}-process`);fs.mkdirSync(log);
   const remaining=Math.floor(deadline-performance.now());assert.ok(remaining>=1000,'Registry setup deadline exhausted');
   const measured=await boundedInstallProcess('npm',args,{cwd:project,directory:log,env,timeoutMs:Math.min(60000,remaining),reserveBytes:2*1024**3,maxGrowthBytes:300*1024**2,maxLogBytes:2*1024**2,terminateDescendants:true});
   fs.copyFileSync(path.join(log,'stdout.log'),path.join(directory,`${name}-stdout.json`));fs.copyFileSync(path.join(log,'stderr.log'),path.join(directory,`${name}-stderr.log`));save(`${name}-process.json`,measured);
   assert.equal(measured.exitCode,name==='negative'?1:0,'Registry command must preserve native failure exits');assert.equal(measured.signal,null);assert.equal(measured.reason,null);
   const capture=JSON.parse(fs.readFileSync(path.join(log,'stdout.log'),'utf8'));results[name]=capture;
   save(`${name}-config.json`,JSON.parse(fs.readFileSync(path.join(project,'tddswarm.config.json'),'utf8')));
   assert.equal(registrySetupCaptureComplete(capture,name==='negative'),true);
   assert.equal(git('rev-parse','HEAD'),head);for(const file of ['test/a.test.js','test/b.test.js'])assert.equal(fs.readFileSync(path.join(project,file),'utf8'),files[file]);
  }
  const packages=fs.readdirSync(path.join(cache,'_npx')).map(entry=>path.join(cache,'_npx',entry,'node_modules/testlore')).filter(dir=>fs.existsSync(path.join(dir,'package.json')));assert.equal(packages.length,1);
  const installed=fs.realpathSync(packages[0]);assert.ok(installed.startsWith(fs.realpathSync(cache)+path.sep));
  assert.equal(fileIdentity(path.join(installed,'package.json')).sha256,binding.installedManifestSha256);assert.equal(fileIdentity(path.join(installed,'src/cli.js')).sha256,binding.installedCliSha256);
  fs.copyFileSync(path.join(installed,'package.json'),path.join(directory,'installed-manifest.json'));
  fs.copyFileSync(path.join(installed,'src/cli.js'),path.join(directory,'installed-cli.js'));
  const evidence={schemaVersion:1,kind:'exact-registry-version-setup',...binding,producerSha256:fileIdentity(fileURLToPath(import.meta.url)).sha256,qualified:true,isolatedProfiles:true,freshIsolatedCache:true,originalAssertionsPreserved:true,registryArchiveVerified:true,liveProviders:false,liveGitHub:false,modelCost:null,coldTimingClaim:false,durationMs:Math.round(performance.now()-started),...results,rawEvidence:rawNames.map(file=>{const identity=fileIdentity(path.join(directory,file),2*1024**2);return{file,bytes:identity.bytes,sha256:identity.sha256};}),limitations:['Controlled Node adoption checks only; no broad framework compatibility or safe-omission claim.','A fresh private npm cache is reused across three invocations; timings do not establish cold/warm performance or a speed advantage.','No provider calls, repair efficacy, maintainer acceptance or learning improvement evaluated.']};
  verifyRegistrySetupRaw(directory,evidence,{...binding,producerSha256:fileIdentity(fileURLToPath(import.meta.url)).sha256});save('registry-setup-proof.json',evidence);return evidence;
 } finally {fs.rmSync(workspace,{recursive:true,force:true});}
}

if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--receipt'||args[2]!=='--output')throw Error('Use --receipt qualified-release-candidate.json --output NEW_DIR');
 const result=await registrySetupProof({receipt:args[1],output:args[3]});console.log(JSON.stringify({version:result.version,qualified:result.qualified,sourceRevision:result.sourceRevision}));
}
