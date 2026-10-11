import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {safePath} from './files.js';
import {readInvestigationInput} from './bug-investigation.js';
import {readBugRecipe,verifyBugRecipeQualification} from './bug-recipes.js';

const bundled=fileURLToPath(new URL('./probe-catalog/',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=/^[a-f0-9]{64}$/;
function captureCatalog(){
 const capturedCatalog=readInvestigationInput(bundled,'catalog.json',{maxBytes:65536}),catalog=capturedCatalog.value;
 if(catalog.schemaVersion!==1||catalog.kind!=='verified-historical-correctness-replay-catalog'||!Array.isArray(catalog.entries)||catalog.entries.length>32||catalog.automaticExecution!==false||catalog.requiresCurrentMaintainerContract!==true||catalog.nativeSuiteValidated!==false||catalog.repairAuthority!=='none'||catalog.learningPromoted!==false)throw new Error('Invalid bundled historical probe catalog');
 const ids=new Set(),members=new Map([['catalog.json',capturedCatalog.sha256]]),entries=[];
 for(const entry of catalog.entries){
  if(ids.has(entry.id)||!hash.test(entry.recipeFileSha256)||!hash.test(entry.recipeSha256)||!hash.test(entry.qualificationSha256))throw new Error('Invalid bundled recipe identity');ids.add(entry.id);
  const loaded=readBugRecipe(bundled,entry.recipeFile,entry.recipeFileSha256),proof=verifyBugRecipeQualification(bundled,entry.qualificationFile,{expectedSha256:entry.qualificationSha256,recipeSha256:entry.recipeSha256});
  if(loaded.recipe.id!==entry.id||loaded.recipe.family!==entry.family||loaded.recipeSha256!==entry.recipeSha256||proof.qualified!==true)throw new Error('Bundled recipe differs from replay qualification');
  members.set(entry.recipeFile,entry.recipeFileSha256);members.set(entry.qualificationFile,entry.qualificationSha256);for(const reference of proof.bindings){if(members.has(reference.path)&&members.get(reference.path)!==reference.sha256)throw new Error('Catalog member has conflicting qualification identities');members.set(reference.path,reference.sha256);}
  entries.push({id:entry.id,family:entry.family,recipeSha256:entry.recipeSha256,contract:loaded.recipe.contract.text,source:loaded.recipe.contract.sourceUrl,repository:entry.sourceRepository,scope:'pure-module-replay',targetApplicability:'requires-independent-contract-review'});
 }
 const files=[];let total=0;
 for(const [file,expectedSha256] of members){const captured=readInvestigationInput(bundled,file,{expectedSha256,maxBytes:2*1024*1024,json:false});total+=captured.bytes;if(total>4*1024*1024)throw new Error('Bundled probe catalog exceeds 4 MiB');const bytes=Buffer.from(captured.value,'utf8');if(sha(bytes)!==captured.sha256)throw new Error('Bundled catalog must use exact UTF-8 bytes without a byte-order mark');files.push({file,bytes,sha256:captured.sha256});}
 return {catalog,entries,files};
}
export function listBundledBugRecipes(){
 const {entries}=captureCatalog();return {schemaVersion:1,kind:'bundled-bug-recipes',entries,automaticExecution:false,nativeSuiteValidated:false,repairAuthority:'none',learningPromoted:false,nextAction:'Copy the catalog with probe-catalog --execute. Review target behavior and create tddswarm.probes.json before running any module probe.'};
}
/** Copies public declarations and observed replay facts only; never installs dependencies or executes project code. */
export function installBundledBugRecipes(root,{directory='testlore/recipes'}={}){
 const target=safePath(root,directory);if(fs.existsSync(target))throw new Error('Probe catalog output already exists; existing project files are preserved');
 const {catalog,entries,files}=captureCatalog();
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target,{recursive:false});
 for(const member of files){if(sha(member.bytes)!==member.sha256)throw new Error('Bundled recipe bytes changed during capture');const destination=safePath(target,member.file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,member.bytes,{flag:'wx'});}
 const recipes=catalog.entries.map(entry=>({path:`${directory}/${entry.recipeFile}`,sha256:entry.recipeFileSha256,qualification:{path:`${directory}/${entry.qualificationFile}`,sha256:entry.qualificationSha256}}));
 return {kind:'installed-bug-recipes',directory,entries,recipes,projectCodeExecuted:false,providerCalls:0,automaticExecution:false,repairAuthority:'none',nextAction:'Review the copied public recipes, independently approve target expectations, and commit tddswarm.probes.json. No background service was started.'};
}
