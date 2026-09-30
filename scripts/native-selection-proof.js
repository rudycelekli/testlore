#!/usr/bin/env node
// Reproducible, independently specified runtime input missed by an imports selector.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {run} from '../src/runner.js';import {execute,discover,executeNativeRelated} from '../src/execution.js';import {digest} from '../src/provenance.js';
const repository=fileURLToPath(new URL('../',import.meta.url)),tools=path.join(repository,'node_modules');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-native-selection-'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
const git=args=>{const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',shell:false});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();};
try{
 const config={adapter:'vitest',discovery:'native',runner:[process.execPath,path.join(tools,'vitest/vitest.mjs'),'run','{files}'],analysisCache:{enabled:true},dependencies:{'landing.test.js':['public/copy.json']}};
 const fixture={'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules\n','src/landing.js':'export const visible=true;', 'src/pricing.js':'export const free=true;', 'public/copy.json':{heading:'Welcome builders'},
 'landing.test.js':"import {test,expect} from 'vitest';import fs from 'node:fs';import {visible} from './src/landing.js';test('specified visible heading',()=>{expect(visible).toBe(true);expect(JSON.parse(fs.readFileSync(new URL('./public/copy.json',import.meta.url))).heading).toBe('Welcome builders')});",
 'pricing.test.js':"import {test,expect} from 'vitest';import {free} from './src/pricing.js';test('specified free pricing',()=>expect(free).toBe(true));", 'tddswarm.config.json':config};
 for(const [file,value]of Object.entries(fixture))write(file,value);fs.symlinkSync(tools,path.join(root,'node_modules'));
 git(['init','-b','main']);git(['-c','user.name=TestLore Proof','-c','user.email=proof@localhost','add','.']);git(['-c','user.name=TestLore Proof','-c','user.email=proof@localhost','commit','-m','Independent fixture']);
 const baseline=execute(root,discover(root,config).files,config,{capture:true});if(!baseline.complete||baseline.exitCode!==0)throw new Error('Incomplete baseline');
 write('public/copy.json',{heading:'Broken copy'});const trials=[];
 for(let repeat=0;repeat<3;repeat++){
  fs.rmSync(path.join(root,'.tddswarm'),{recursive:true,force:true});const methods=['full','testlore','native'],order=[...methods.slice(repeat),...methods.slice(0,repeat)],outcomes={};
  for(const method of order){const started=performance.now();outcomes[method]=method==='testlore'?run(root,{base:'HEAD',capture:true,selective:true}):method==='native'?executeNativeRelated(root,['public/copy.json'],config,{capture:true}):execute(root,discover(root,config).files,config,{capture:true});outcomes[method].measuredTotalMs=Math.round(performance.now()-started);}
  const failed=report=>report.tests.filter(test=>test.status==='failed').map(test=>test.id).sort(),expected=failed(outcomes.full);
  trials.push({repeat,order,fullCaught:expected.length===1,testLoreCaught:JSON.stringify(failed(outcomes.testlore))===JSON.stringify(expected),nativeCaught:JSON.stringify(failed(outcomes.native))===JSON.stringify(expected),outcomes});
 }
 const normalize=value=>JSON.parse(JSON.stringify(value).split(root).join('<fixture>').split(repository).join('<repository>').split(process.execPath).join('<node>').replace(/\/(?:private\/)?var\/folders\/[^\s:'"\\]+\/T\/(?:tddswarm|testlore)-[^/\s:'"\\]+/g,'<scratch>').replace(/\/(?:private\/)?tmp\/(?:tddswarm|testlore)-[^/\s:'"\\]+/g,'<scratch>'));
 const result=normalize({schemaVersion:1,kind:'native-selector-runtime-input',passed:trials.every(t=>t.fullCaught&&t.testLoreCaught&&!t.nativeCaught&&Object.values(t.outcomes).every(r=>r.complete)),node:process.version,vitest:JSON.parse(fs.readFileSync(path.join(tools,'vitest/package.json'))).version,requirement:'The landing heading is exactly Welcome builders, and pricing remains free.',fixture,trials,implementationHashes:Object.fromEntries(['src/runner.js','src/execution.js','src/selector.js','src/graph.js'].map(file=>[file,digest(fs.readFileSync(path.join(repository,file)))])),limitations:['Constructed two-file runtime-asset counterexample, not representative speed or fault recall.','TestLore uses an explicit asset declaration and retains uncertain consumers. Vitest related has no equivalent runtime declaration in this comparison.','Full timing here includes reference discovery; application pilot fullMs uses native execution only for a conservative speed baseline.','Native zero-case execution is complete within its selected scope but misses the independent asset defect. No speed win is credited to a missed defect.']});
 const output=process.argv[2]||'.tddswarm/native-selection-proof.json';fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,trials:trials.length,output}));process.exitCode=result.passed?0:1;
}finally{fs.rmSync(root,{recursive:true,force:true});}
