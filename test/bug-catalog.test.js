import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.js';
import {listBundledBugRecipes,installBundledBugRecipes} from '../src/bug-catalog.js';
import {readBugRecipe,verifyBugRecipeQualification} from '../src/bug-recipes.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('installed public catalog preserves exact qualified recipe and raw historical observation bytes',t=>{
 const root=fixture(t),listed=listBundledBugRecipes();assert.equal(listed.entries.length,3);assert.equal(listed.automaticExecution,false);assert.equal(listed.learningPromoted,false);
 const copied=installBundledBugRecipes(root);assert.equal(copied.providerCalls,0);assert.equal(copied.projectCodeExecuted,false);
 for(const reference of copied.recipes){const loaded=readBugRecipe(root,reference.path,reference.sha256),verified=verifyBugRecipeQualification(root,reference.qualification.path,{expectedSha256:reference.qualification.sha256,recipeSha256:loaded.recipeSha256});assert.equal(verified.qualified,true);assert.equal(verified.receipt.nativeSuiteValidated,false);}
 assert.equal(fs.existsSync(path.join(root,'tddswarm.probes.json')),false);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
 const original=fs.readFileSync(path.join(root,'testlore/recipes/catalog.json'));assert.throws(()=>installBundledBugRecipes(root),/already exists/);assert.deepEqual(fs.readFileSync(path.join(root,'testlore/recipes/catalog.json')),original);
});
test('catalog installation refuses traversal and symlink destinations',t=>{
 const root=fixture(t),elsewhere=fixture(t);assert.throws(()=>installBundledBugRecipes(root,{directory:'../escaped'}));fs.symlinkSync(elsewhere,path.join(root,'external'),'dir');assert.throws(()=>installBundledBugRecipes(root,{directory:'external/recipes'}));assert.deepEqual(fs.readdirSync(elsewhere),[]);
});
test('CLI provides immediate truthful immunity inspection and bounded catalog setup without project execution',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/danger.js':"throw new Error('project code must not execute during inspection')"}),invoke=(...args)=>spawnSync(process.execPath,[path.resolve('src/cli.js'),...args,'--root',root,'--json'],{encoding:'utf8'});
 const status=invoke('immunity');assert.equal(status.status,0,status.stderr);const report=JSON.parse(status.stdout);assert.equal(report.status,'awaiting-reviewed-probes');assert.equal(report.backgroundServiceRunning,false);assert.equal(report.catalog.entries.length,3);
 assert.equal(invoke('probe-catalog','--execute').status,0);const bytes=fs.readFileSync(path.join(root,'testlore/recipes/catalog.json'));assert.equal(sha(bytes),sha(fs.readFileSync('src/probe-catalog/catalog.json')));
 assert.equal(invoke('probe-qualify','--manifest','testlore/recipes/catalog.json','--execute').status,2);
});
