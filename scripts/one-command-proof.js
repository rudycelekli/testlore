import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fileIdentity} from './worker-identity.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const names=['default','disabled','negative'];
const rawNames=[...names.flatMap(name=>[name+'-stdout.json',name+'-stderr.log',name+'-process.json',name+'-config.json']),'installed-manifest.json','installation.json','preregistration.json'].sort();
const rawComplete=index=>Array.isArray(index)&&index.length===15&&JSON.stringify(index.map(item=>item?.file).sort())===JSON.stringify(rawNames)&&index.every(item=>item&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=2*1024*1024&&hex(item.sha256));
const cases=(run,failed)=>run?.complete===true&&!run.signal&&!run.error&&(!run.reportErrors||Array.isArray(run.reportErrors)&&!run.reportErrors.length)&&run.exitCode===(failed?1:0)&&run.shadow===true&&Array.isArray(run.tests)&&run.tests.every(test=>test&&typeof test==='object')&&JSON.stringify(run.tests.map(test=>[test.file,test.name,test.status]).sort())===JSON.stringify([['test/a.test.js','one-command a','passed'],['test/b.test.js','one-command b',failed?'failed':'passed']])&&Array.isArray(run.executedFiles)&&JSON.stringify([...run.executedFiles].sort())==='["test/a.test.js","test/b.test.js"]';
function decisions(value,disabled){
 return value?.blocked===false&&value.execution?.selected==='core'&&Array.isArray(value.decisions)&&value.decisions.length>=8&&value.decisions.every(item=>item&&['retain','enable','skip'].includes(item.action)&&Array.isArray(item.reasons)&&item.reasons.length>0)&&value.decisions.some(item=>item.id==='core'&&item.action==='retain')&&value.decisions.some(item=>item.id==='c8'&&item.action===(disabled?'retain':'skip'))&&(!disabled||value.decisions.some(item=>item.id==='agentic-qe'&&item.action==='retain'))&&Array.isArray(value.applied)&&value.applied.length===0;
}
export function oneCommandEvidenceComplete(value){
 return value?.qualified===true&&value.kind==='sealed-local-archive-npm-exec'&&value.isolatedProfiles===true&&value.isolatedCache===true&&value.cacheReusedWithinProof===true&&value.coldTimingClaim===false&&value.registryPublicationVerified===false&&value.liveProviders===false&&value.liveGitHub===false&&value.modelCost===null&&hex(value.archiveSha256)&&hex(value.installedManifestSha256)&&hex(value.installedCliSha256)&&hex(value.proofScriptSha256)&&/^[a-f0-9]{40}$/.test(value.sourceRevision||'')&&value.automaticNativeAdapter==='node'&&value.default?.executionMode==='shadow'&&value.disabled?.executionMode==='shadow'&&cases(value.default.verification,false)&&cases(value.disabled.verification,false)&&cases(value.negative?.verification,true)&&decisions(value.default.plugins,false)&&decisions(value.disabled.plugins,true)&&value.explicitDisabledPreserved===true&&value.originalAssertionsPreserved===true&&value.installedCacheBindingVerified===true&&value.negative.exitCode===1&&rawComplete(value.rawEvidence);
}
export function verifyOneCommandRawEvidence(directory,evidence){
 if(!oneCommandEvidenceComplete(evidence))throw Error('One-command evidence contract incomplete');
 if(!rawComplete(evidence?.rawEvidence))throw Error('One-command raw evidence index incomplete');
 for(const item of evidence.rawEvidence){const file=path.join(directory,item.file),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size!==item.bytes)throw Error('One-command raw evidence size changed');if(fileIdentity(file,2*1024*1024).sha256!==item.sha256)throw Error('One-command raw evidence changed');}
 const read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
 for(const name of names){const observed=read(name+'-stdout.json'),measured=read(name+'-process.json'),config=read(name+'-config.json');
  assert.deepEqual(evidence[name],name==='negative'?{...observed,exitCode:measured.exitCode}:observed,'One-command raw result and summary disagree');
  assert.equal(measured.exitCode,name==='negative'?1:0);assert.equal(measured.reason,null);assert.equal(measured.signal,null);assert.equal(config.adapter,'node');assert.equal(config.executionMode,'shadow');
  if(name==='disabled'){assert.deepEqual(config.plugins.c8,{enabled:false});assert.deepEqual(config.plugins['agentic-qe'],{enabled:false});}
 }
 assert.equal(fileIdentity(path.join(directory,'installed-manifest.json'),2*1024*1024).sha256,evidence.installedManifestSha256);
 const installed=read('installed-manifest.json');assert.equal(installed.name,'testlore');assert.equal(installed.gitHead,evidence.sourceRevision);
 const installation=read('installation.json'),preregistration=read('preregistration.json');
 for(const key of ['archiveSha256','sourceRevision','installedManifestSha256','installedCliSha256'])assert.equal(installation[key],evidence[key]);
 assert.equal(installation.cacheInstallations,1);assert.equal(installation.npmExecCacheInstallationObserved,true);assert.equal(installation.environmentCredentialsPassed,false);
 assert.equal(preregistration.archiveSha256,evidence.archiveSha256);assert.equal(preregistration.sourceRevision,evidence.sourceRevision);
 return true;
}

/** Actual npm exec installs and invokes the same sealed tar; no fake npm/CLI. */
export async function oneCommandProof({workspace,archive,archiveSha256,sourceRevision,installedManifestSha256,installedCliSha256,evidenceDirectory}){
 const started=performance.now(),deadline=started+90000;
 assert.ok(hex(archiveSha256)&&hex(installedManifestSha256)&&hex(installedCliSha256));assert.match(sourceRevision,/^[a-f0-9]{40}$/);
 assert.equal(fileIdentity(archive,20*1024*1024).sha256,archiveSha256);
 const base=path.join(workspace,'one-command');fs.mkdirSync(base);const home=path.join(base,'home'),cache=path.join(base,'cache'),temporary=path.join(base,'tmp');fs.mkdirSync(home);fs.mkdirSync(cache);fs.mkdirSync(temporary);fs.mkdirSync(evidenceDirectory,{recursive:true});
 const userConfig=path.join(base,'npm-user-config'),globalConfig=path.join(base,'npm-global-config');fs.writeFileSync(userConfig,'');fs.writeFileSync(globalConfig,'');
 const env={PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),HOME:home,TMPDIR:temporary,CI:'true',GIT_CONFIG_GLOBAL:userConfig,GIT_CONFIG_NOSYSTEM:'1',npm_config_cache:cache,npm_config_userconfig:userConfig,npm_config_globalconfig:globalConfig,npm_config_ignore_scripts:'true',npm_config_omit:'dev',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'https://registry.npmjs.org/'};
 const save=(file,value)=>fs.writeFileSync(path.join(evidenceDirectory,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{env,shell:false,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const {boundedInstallProcess}=await import('./public-corpus-upstream.js');
 save('preregistration.json',{archiveSha256,sourceRevision,command:['npm','exec','--yes','--package=<sealed archive>','--','testlore','setup','--verify','--json'],deadlineMs:90000,reserveBytes:2*1024**3,maxGrowthBytes:300*1024**2,profiles:'isolated empty npm user/global profiles, credential-free environment',cache:'fresh isolated cache reused across three invocations; no cold latency claim',expected:{default:'shadow Node, two named passes and automatic decisions',disabled:'explicit c8/AQE disabled choices preserved',negative:'complete shadow failure retained with exit 1'}});
 const results={},configs={},processes={};
 for(const name of names){
  const project=path.join(base,name);fs.mkdirSync(project);
  const files={'package.json':JSON.stringify({name:'one-command-'+name,type:'module',scripts:{test:'node --test'}}),'.gitignore':'.tddswarm/\nnode_modules/\n','src/a.js':'export const a=1;','src/b.js':name==='negative'?'export const b=9;':'export const b=2;',
   'test/a.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../src/a.js';test('one-command a',()=>assert.equal(a,1));",'test/b.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {b} from '../src/b.js';test('one-command b',()=>assert.equal(b,2));"};
  if(name==='disabled')files['tddswarm.config.json']=JSON.stringify({adapter:'node',discovery:'native',executionMode:'shadow',runner:[process.execPath,'--test','{files}'],plugins:{c8:{enabled:false},'agentic-qe':{enabled:false}}});
  for(const [file,content]of Object.entries(files)){const target=path.join(project,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
  for(const args of [['init','-b','main'],['config','user.name','One Command Proof'],['config','user.email','proof@example.invalid'],['config','commit.gpgsign','false'],['add','.'],['commit','-m','Independent one-command assertions']])git(project,...args);
  const head=git(project,'rev-parse','HEAD'),log=path.join(base,name+'-process');fs.mkdirSync(log);
  const remaining=Math.floor(deadline-performance.now());if(remaining<1000)throw Error('One-command campaign deadline exhausted');
  const args=['exec','--yes','--package='+fs.realpathSync(archive),'--','testlore','setup','--verify','--json'];
  const measured=await boundedInstallProcess('npm',args,{cwd:project,directory:log,env,timeoutMs:Math.min(name==='default'?60000:15000,remaining),reserveBytes:2*1024**3,maxGrowthBytes:300*1024**2,maxLogBytes:2*1024**2,terminateDescendants:true});
  for(const stream of ['stdout','stderr'])fs.copyFileSync(path.join(log,stream+'.log'),path.join(evidenceDirectory,name+'-'+(stream==='stdout'?'stdout.json':'stderr.log')));
  save(name+'-process.json',measured);processes[name]=measured;
  assert.equal(measured.reason,null,'Actual npm exec rejected: '+measured.reason);assert.equal(measured.signal,null);assert.equal(measured.exitCode,name==='negative'?1:0);
  const result=JSON.parse(fs.readFileSync(path.join(log,'stdout.log'),'utf8'));results[name]=result;const config=JSON.parse(fs.readFileSync(path.join(project,'tddswarm.config.json'),'utf8'));configs[name]=config;save(name+'-config.json',config);
  assert.equal(config.adapter,'node');assert.equal(config.executionMode,'shadow');assert.equal(result.executionMode,'shadow');assert.equal(result.agent.executed,false);assert.equal(cases(result.verification,name==='negative'),true);
  if(name!=='negative')assert.equal(decisions(result.plugins,name==='disabled'),true);
  if(name==='disabled'){assert.deepEqual(config.plugins.c8,{enabled:false});assert.deepEqual(config.plugins['agentic-qe'],{enabled:false});}
  assert.equal(git(project,'rev-parse','HEAD'),head);for(const file of ['test/a.test.js','test/b.test.js'])assert.equal(fs.readFileSync(path.join(project,file),'utf8'),files[file]);
 }
 const npx=path.join(cache,'_npx'),entries=fs.readdirSync(npx);assert.ok(entries.length>0&&entries.length<=16);
 const packages=entries.map(entry=>path.join(npx,entry,'node_modules/testlore')).filter(pkg=>fs.existsSync(path.join(pkg,'package.json')));assert.equal(packages.length,1,'Expected one shared installation of the exact archive');
 const installed=fs.realpathSync(packages[0]);assert.ok(installed.startsWith(fs.realpathSync(cache)+path.sep));
 const manifest=fs.readFileSync(path.join(installed,'package.json')),metadata=JSON.parse(manifest),cli=path.join(installed,'src/cli.js');assert.equal(metadata.name,'testlore');assert.equal(metadata.gitHead,sourceRevision);assert.equal(hash(manifest),installedManifestSha256);assert.equal(fileIdentity(cli).sha256,installedCliSha256);
 assert.equal(fs.realpathSync(path.join(path.dirname(installed),'.bin/testlore')),fs.realpathSync(cli));
 for(const result of Object.values(results)){const reporter=result.verification.command.find(arg=>arg.startsWith('--test-reporter='));assert.equal(fs.realpathSync(reporter.slice('--test-reporter='.length)),fs.realpathSync(path.join(installed,'src/reporters/node.js')));}
 fs.writeFileSync(path.join(evidenceDirectory,'installed-manifest.json'),manifest,{flag:'wx'});
 save('installation.json',{archiveSha256,sourceRevision,installedManifestSha256,installedCliSha256,cacheInstallations:packages.length,npmExecCacheInstallationObserved:true,processes,environmentCredentialsPassed:false});
 assert.equal(fileIdentity(archive,20*1024*1024).sha256,archiveSha256);
 const evidence={schemaVersion:1,qualified:true,kind:'sealed-local-archive-npm-exec',archiveSha256,sourceRevision,installedManifestSha256,installedCliSha256,proofScriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),isolatedProfiles:true,isolatedCache:true,cacheReusedWithinProof:true,coldTimingClaim:false,registryPublicationVerified:false,liveProviders:false,liveGitHub:false,modelCost:null,automaticNativeAdapter:configs.default.adapter,default:results.default,disabled:results.disabled,negative:{...results.negative,exitCode:processes.negative.exitCode},explicitDisabledPreserved:true,originalAssertionsPreserved:true,installedCacheBindingVerified:true,durationMs:Math.round(performance.now()-started),rawEvidence:rawNames.map(file=>{const binding=fileIdentity(path.join(evidenceDirectory,file),2*1024*1024);return{file,bytes:binding.bytes,sha256:binding.sha256};}),limitations:['Actual npm exec from an exact sealed local tar; no public registry publication or release identity established.','Controlled Node fixtures and retained negative case; no real plugin/provider compatibility or general quality/speed claim.','Isolated cache reused across three invocations; these timings are not a cold-start benchmark.']};
 assert.equal(oneCommandEvidenceComplete(evidence),true);verifyOneCommandRawEvidence(evidenceDirectory,evidence);return evidence;
}
