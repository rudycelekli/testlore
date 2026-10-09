#!/usr/bin/env node
// Credential-free runtime composition assay. Immutable shared candidates, not competing authors.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {readBoundedJson} from './evaluation-commitment.js';

export const sha256=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const defaultManifest=fileURLToPath(new URL('../benchmarks/aqe-comparison/is-number-whitespace-v1/manifest-vitest.json',import.meta.url));
const jsonWrite=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
function local(root,file){if(typeof file!=='string'||path.isAbsolute(file)||file.split('/').some(p=>!p||['.','..'].includes(p)))throw new Error('Noncanonical dataset path');return path.join(root,file);}
export function loadAqeComparison(manifestFile=defaultManifest){
 const manifest=readBoundedJson(manifestFile),root=path.dirname(path.resolve(manifestFile));
 if(manifest.schemaVersion!==1||manifest.kind!=='aqe-shared-candidate-runtime-comparison'||manifest.budgets.generationCalls!==2||manifest.budgets.repeat!==2||manifest.budgets.stabilityRuns!==2||manifest.budgets.retries!==0||manifest.budgets.modelCalls!==0)throw new Error('Invalid preregistered comparison budgets');
 const provenance=readBoundedJson(local(root,manifest.provenance));
 if(sha256(fs.readFileSync(local(root,manifest.provenance)))!==manifest.provenanceSha256)throw new Error('Dataset provenance commitment changed');
 const bytes=new Map();
 for(const binding of provenance.bindings){const p=local(root,binding.path),stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Invalid bounded upstream source');const b=fs.readFileSync(p);if(b.length!==binding.bytes||sha256(b)!==binding.sha256)throw new Error('Upstream source identity changed');const gitBlob=createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');if(gitBlob!==binding.gitBlob)throw new Error('Upstream Git blob mismatch');bytes.set(binding.path,b.toString('utf8'));}
 const source=bytes.get(manifest.fixture.fixed),fault=bytes.get(manifest.fixture.fault),original=bytes.get(manifest.fixture.originalOracle);
 if(!source||!fault||source===fault||!original?.includes("  '   ', // issue#3\n  '\\r\\n\\t', // issue#3")||!original.includes('assert.equal(isNumber(num), false);'))throw new Error('Maintainer whitespace oracle contract changed');
 // Freeze selected historical table entries and exact assertion body before generation.
 const nodeReference="const {describe,it}=require('node:test');\nvar assert=require('node:assert');\nvar isNumber=require('../src/is-number.js');\nconst shouldFail=['   ','\\r\\n\\t'];\ndescribe('is not a number',function(){shouldFail.forEach(function(num){it(JSON.stringify(num)+' should not be a number',function(){assert.equal(isNumber(num), false);});});});\n";
 const framework=manifest.framework||'node';if(!['node','vitest'].includes(framework))throw Error('Unsupported preregistered framework');
 const reference=framework==='node'?nodeReference:"import {describe,it} from 'vitest';\nimport assert from 'node:assert';\nimport {createRequire} from 'node:module';\nconst require=createRequire(import.meta.url);\nvar isNumber=require('../src/is-number.js');\nconst shouldFail=['   ','\\r\\n\\t'];\ndescribe('is not a number',function(){shouldFail.forEach(function(num){it(JSON.stringify(num)+' should not be a number',function(){assert.equal(isNumber(num), false);});});});\n";
 if(sha256(reference)!==manifest.fixture.referenceSha256)throw new Error('Frozen oracle adaptation changed');
 return {framework,manifest,manifestHash:sha256(fs.readFileSync(manifestFile)),source,fault,reference};
}
export function summarizeAqePair(generation,runs,validation){
 const success=report=>report?.complete===true&&report.exitCode===0&&report.tests?.some(t=>t.status==='passed')&&!report.tests?.some(t=>t.status==='failed');
 const caught=report=>report?.complete===true&&report.exitCode===1&&report.tests?.some(t=>t.status==='failed'&&t.name!=='<file-load>');
 const identities=report=>(report?.tests||[]).map(t=>[t.file,t.name,t.status]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const stable=runs.fixed.length===2&&runs.fixed.every(success)&&JSON.stringify(identities(runs.fixed[0]))===JSON.stringify(identities(runs.fixed[1]));
 const demonstrated=runs.oracleFixed.length===2&&runs.oracleFault.length===2&&runs.oracleFixed.every(success)&&runs.oracleFault.every(caught);
 const faultCaught=generation.complete===true&&stable&&demonstrated&&runs.fault.length===2&&runs.fault.every(caught)&&JSON.stringify(identities(runs.fault[0]))===JSON.stringify(identities(runs.fault[1]));
 return {comparisonExecuted:generation.complete===true&&validation!==null,rejectionCategory:/Unsupported test framework/i.test((generation.stderr||'')+(generation.error||''))?'unsupported-framework':generation.complete===true?null:'generation-rejected-or-incomplete',generationComplete:generation.complete===true,generationRejected:generation.complete!==true,timedOut:/timed?\s*out|ETIMEDOUT/i.test(generation.error||''),candidateStable:stable,independentFaultDemonstrated:demonstrated,candidateCaughtHistoricalFault:faultCaught,upstreamQualityGates:generation.upstream?.qualityGates||[],aqeAlone:{returnedDraft:generation.complete===true,measuredCaught:faultCaught,promotionPolicy:'Not inferred from a CLI quality score.'},aqePlusTestLore:{accepted:validation?.accepted===true,measuredCaught:validation?.accepted===true&&faultCaught,reasons:validation?.reasons||['generation-did-not-complete']},detectionImprovementClaim:false,cost:{providerCurrency:null,tokens:null,paidCredentialsPassed:false},learningImprovementClaim:false};
}

export async function runAqeComparison({output,aqePackage,dependencyDirectory,manifestFile=defaultManifest}={}){
 const loaded=loadAqeComparison(manifestFile),{framework,manifest,source,fault,reference}=loaded;
 const referenceFile=framework==='vitest'?'test/maintainer.test.mjs':'test/maintainer.test.cjs';
 const rootVitestPackage=fileURLToPath(new URL('../node_modules/vitest',import.meta.url));
 let nativeRuntimeBinding=null;
 if(framework==='vitest'){const metadata=readBoundedJson(path.join(rootVitestPackage,'package.json'));const rootLockFile=fileURLToPath(new URL('../package-lock.json',import.meta.url)),rootLock=readBoundedJson(rootLockFile,8*1024*1024);if(metadata.name!=='vitest'||metadata.version!==manifest.nativeRunner?.version||rootLock.packages?.['node_modules/vitest']?.version!==manifest.nativeRunner.version)throw Error('Native Vitest differs from preregistered root installation');nativeRuntimeBinding={packageSha256:sha256(fs.readFileSync(path.join(rootVitestPackage,'package.json'))),lockSha256:sha256(fs.readFileSync(rootLockFile)),entrySha256:sha256(fs.readFileSync(path.join(rootVitestPackage,'vitest.mjs'))),version:metadata.version,lockIdentity:rootLock.packages['node_modules/vitest']};}
 if(!output||fs.existsSync(path.resolve(output)))throw new Error('Explicit fresh output directory required');
 const pkg=readBoundedJson(path.join(path.resolve(aqePackage||''),'package.json'));
 if(pkg.name!=='agentic-qe'||pkg.version!==manifest.upstream.version||!['dist/cli/bundle.js','./dist/cli/bundle.js'].includes(pkg.bin?.aqe))throw new Error('Installed AQE differs from preregistered release');
 const cli=path.join(path.resolve(aqePackage),'dist/cli/bundle.js');
 const dep=readBoundedJson(path.join(path.resolve(dependencyDirectory||''),'kind-of/package.json'));
 if(dep.name!=='kind-of'||dep.version!=='3.0.2')throw new Error('Historical dependency must be kind-of@3.0.2');
 const lockFile=path.join(path.dirname(path.resolve(dependencyDirectory)),'package-lock.json'),lock=readBoundedJson(lockFile,8*1024*1024);
 const aqeLock=lock.packages?.['node_modules/agentic-qe'],kindLock=lock.packages?.['node_modules/kind-of'];
 if(aqeLock?.version!==manifest.upstream.version||aqeLock.integrity!==manifest.upstream.npmIntegrity||kindLock?.version!=='3.0.2'||!kindLock.integrity)throw new Error('Installation lock must bind the preregistered AQE distribution and historical dependency');
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 jsonWrite(path.join(output,'preregistration.json'),{...manifest,manifestHash:loaded.manifestHash,startedAt:new Date().toISOString(),cliSha256:sha256(fs.readFileSync(cli)),installedPackageSha256:sha256(fs.readFileSync(path.join(aqePackage,'package.json'))),node:process.version,preparationExcluded:true,installLockHash:sha256(fs.readFileSync(lockFile)),installation:{aqe:aqeLock,kindOf:kindLock},framework,nativeRuntimeBinding,childEnvironment:'Fresh HOME/TMPDIR and PATH/locale only; inherited credentials and model configuration removed.'});
 const {aqeGenerate}=await import('../src/adapters/aqe.js');
 const {stagePatch,validateCandidates}=await import('../src/candidates.js');
 const {execute}=await import('../src/execution.js');
 const {readConfig}=await import('../src/files.js');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-aqe-comparison-'));
 const originalEnvironment={...process.env};
 for(const key of Object.keys(process.env))delete process.env[key];
 for(const key of ['PATH','LANG','LC_ALL','TZ','SystemRoot','WINDIR'])if(originalEnvironment[key])process.env[key]=originalEnvironment[key];
 process.env.HOME=path.join(scratch,'home');process.env.TMPDIR=path.join(scratch,'tmp');fs.mkdirSync(process.env.HOME);fs.mkdirSync(process.env.TMPDIR);
 const receipts=[];const campaignStart=performance.now();
 function write(root,file,content){const p=local(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);}
 try{
  for(let repeat=0;repeat<2;repeat++){
   const root=path.join(scratch,`repeat-${repeat}`);fs.mkdirSync(root);
   write(root,'package.json',JSON.stringify({type:'commonjs'}));write(root,'src/is-number.js',source);write(root,referenceFile,reference);
   write(root,'tddswarm.config.json',JSON.stringify({adapter:framework==='vitest'?'vitest':'node',runner:framework==='vitest'?[process.execPath,path.join(rootVitestPackage,'vitest.mjs'),'run','{files}']:[process.execPath,'--test','{files}'],discovery:'native'}));
   if(framework==='vitest'){fs.mkdirSync(path.join(root,'node_modules'));fs.symlinkSync(path.join(path.resolve(dependencyDirectory),'kind-of'),path.join(root,'node_modules/kind-of'),'dir');fs.symlinkSync(rootVitestPackage,path.join(root,'node_modules/vitest'),'dir');write(root,'vitest.config.mjs',"export default {test:{maxWorkers:1,passWithNoTests:false}};");}else fs.symlinkSync(path.resolve(dependencyDirectory),path.join(root,'node_modules'),'dir');
   const config=readConfig(root);const run=files=>execute(root,files,config,{capture:true,timeoutMs:manifest.budgets.executionTimeoutMs});
   const runs={oracleFixed:[],oracleFault:[],fixed:[],fault:[]};
   for(let n=0;n<2;n++)runs.oracleFixed.push(run([referenceFile]));
   write(root,'src/is-number.js',fault);for(let n=0;n<2;n++)runs.oracleFault.push(run([referenceFile]));write(root,'src/is-number.js',source);
   const generateStart=performance.now();let generation;
   try{generation=aqeGenerate(root,{command:[process.execPath,cli],target:'src/is-number.js',framework,timeoutMs:manifest.budgets.generationTimeoutMs});}catch(error){generation={complete:false,error:error.message};}
   const generationMs=performance.now()-generateStart;
   let candidateFiles=[],validation=null,validationMs=null,candidateHash=null;const evaluationStart=performance.now();
   if(generation.complete){
    candidateFiles=generation.files.map(file=>({path:file,content:fs.readFileSync(path.join(generation.directory,file),'utf8')}));candidateHash=sha256(candidateFiles);
    // Both arms evaluate the exact same files. Existing maintainer tests remain unchanged.
    for(const file of candidateFiles){if(file.path===referenceFile||fs.existsSync(local(root,file.path)))throw new Error('AQE attempted to replace protected oracle');write(root,file.path,file.content);}
    for(let n=0;n<2;n++)runs.fixed.push(run(generation.files));
    write(root,'src/is-number.js',fault);for(let n=0;n<2;n++)runs.fault.push(run(generation.files));write(root,'src/is-number.js',source);
    for(const file of candidateFiles)fs.unlinkSync(local(root,file.path));
    const start=performance.now();
    const staged=stagePatch(root,{files:candidateFiles,requirements:manifest.fixture.requirements,review:{accepted:true,findings:['Automatic executable assay only; no human or model semantic review was invoked.'],oracle:{independent:true,basis:['Frozen upstream maintainer whitespace assertions; historical parent challenge is excluded from author context.']}},heldOutDefects:[{name:'upstream-issue-3-whitespace',path:'src/is-number.js',content:fault}]});
    validation=validateCandidates(root,staged.id,{timeoutMs:manifest.budgets.executionTimeoutMs});validationMs=performance.now()-start;
   }
   const result={repeat,sourceHash:sha256(source),candidateHash,candidateFiles,generation,generationMs,evaluationMs:Math.max(0,performance.now()-evaluationStart-(validationMs||0)),validationMs,runs,validation,summary:summarizeAqePair(generation,runs,validation),timingScope:'Generation includes capability probe, source snapshot, CLI, artifact retention. Candidate-only evaluation excludes composition validation; oracle demonstrations are included in campaign wall time. No falsely additive quality winner.'};
   jsonWrite(path.join(output,`repeat-${repeat}.json`),result);receipts.push(result);
  }
  const summary={schemaVersion:1,completed:true,manifestHash:loaded.manifestHash,generatedAt:new Date().toISOString(),campaignMs:performance.now()-campaignStart,repeats:receipts.map(r=>({repeat:r.repeat,candidateHash:r.candidateHash,generationMs:r.generationMs,evaluationMs:r.evaluationMs,validationMs:r.validationMs,...r.summary})),scope:'One new independently maintained historical defect, two credential-free template generation repetitions; no upstream full installation, live model, learning or general superiority qualification.',qualifiedAdvantage:false};
  jsonWrite(path.join(output,'summary.json'),summary);return summary;
 }catch(error){jsonWrite(path.join(output,'failure.json'),{completed:false,error:error.message,finishedRepeats:receipts.length});throw error;}finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,originalEnvironment);fs.rmSync(scratch,{recursive:true,force:true});}
}
export async function main(argv=process.argv.slice(2)){
 const options={};for(let i=0;i<argv.length;i+=2){if(!['--output','--aqe-package','--dependency-directory','--manifest'].includes(argv[i])||!argv[i+1]||options[argv[i]])throw new Error('Use --output NEW --aqe-package PACKAGE_DIRECTORY --dependency-directory NODE_MODULES [--manifest FILE]');options[argv[i]]=argv[i+1];}
 return runAqeComparison({output:options['--output'],aqePackage:options['--aqe-package'],dependencyDirectory:options['--dependency-directory'],manifestFile:options['--manifest']||defaultManifest});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await main()));}catch(error){console.error(error.message);process.exitCode=1;}}
