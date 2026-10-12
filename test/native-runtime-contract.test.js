import test from 'node:test';
import assert from 'node:assert/strict';
import {captureObservedRuntimeContract,assertObservedRuntimeContract,createObservedRuntimeContext,observeUnimportRuntimeOptions,validateUnimportRuntimeContract} from '../src/native-runtime-contract.js';

function syntheticContext(){
 const root='/reviewed/project',config={root,name:'',environment:'node',pool:'forks',isolate:true,cache:false,typecheck:{enabled:false},browser:{enabled:false},coverage:{enabled:false},setupFiles:[],globalSetup:[],execArgv:[],deps:{optimizer:{client:{enabled:false},ssr:{enabled:false}}}};
 const environments=Object.fromEntries(['__vitest__','client','ssr'].map(name=>[name,{config:{consumer:name==='client'?'client':'server',isBundled:false,plugins:[]}}]));
 const vite={configFile:root+'/testlore.observation.config.mjs',configFileDependencies:[root+'/vitest.config.ts',root+'/testlore.observation.config.mjs'],plugins:[],inlineConfig:{plugins:[]}};
 const project={config,vite:{config:vite,environments}},context={projects:[project],vite:project.vite,getRootProject:()=>project,cache:{results:{getCachePath:()=>null}}};
 return {root,context,profile:{observerConfiguration:{file:'testlore.observation.config.mjs'}}};
}

test('matching synthetic runtime diagnostics and copied JSON never mint live context provenance',()=>{
 const {root,context,profile}=syntheticContext();const diagnostic=observeUnimportRuntimeOptions(context,root,profile);
 assert.ok(diagnostic.environments.__vitest__);assert.equal(captureObservedRuntimeContract(context),null);
 assert.equal(captureObservedRuntimeContract({...context,runtimeContract:{profile:'original-unimport-node22-oxc-runtime-v1',effective:diagnostic,omissionAuthority:true}}),null);
 assert.throws(()=>assertObservedRuntimeContract(context,{...diagnostic}),/qualification changed/);
});

test('effective native observations reject enabled typechecking, browser, shared isolation and setup hooks',()=>{
 for(const [key,value]of [['typecheck',{enabled:true}],['browser',{enabled:true}],['isolate',false],['environment','jsdom'],['pool','threads'],['setupFiles',['/reviewed/project/setup.ts']],['globalSetup',['/reviewed/project/setup.ts']],['execArgv',['--import','untrusted']],['cache',{dir:'writable'}]]){
  const {root,context,profile}=syntheticContext();context.projects[0].config[key]=value;
  assert.throws(()=>observeUnimportRuntimeOptions(context,root,profile),/Unsupported|must be disabled/);
 }
});

test('effective observations reject incomplete environments, client-server substitutions and extra config closure',()=>{
 for(const change of [c=>delete c.projects[0].vite.environments.client,c=>c.projects[0].vite.environments.client.config.consumer='server',c=>c.projects[0].vite.environments.ssr.config.isBundled=true,c=>c.vite.config.configFileDependencies.push('/reviewed/project/unknown.config.ts'),c=>c.projects.push(c.projects[0]),c=>c.cache.results.getCachePath=()=>'/writable/results.json']){
  const {root,context,profile}=syntheticContext();change(context);assert.throws(()=>observeUnimportRuntimeOptions(context,root,profile),/requires|Unsupported|Incomplete|must be disabled/);
 }
});

test('malformed serialized qualification and version/plugin-name claims stay nonauthoritative',()=>{
 for(const value of [undefined,null,{},[],{schemaVersion:1,profile:'original-unimport-node22-oxc-runtime-v1',omissionAuthority:true},{plugins:[{name:'vite:oxc'}],qualified:true}]){
  assert.equal(validateUnimportRuntimeContract(value,null),null);
  assert.equal(validateUnimportRuntimeContract(value,{schemaVersion:1,profile:'original-unimport-runtime-facts-v1',nodeIdentity:{version:'v22.19.0',sha256:'0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1'}}),null);
 }
});

test('ordinary projects never construct an extra native context to request runtime authority',async()=>{
 let starts=0;const module={createVitest:()=>{starts++;throw Error('should not construct');}};
 const context=await createObservedRuntimeContext('/unreviewed',[],null,module,{typecheck:{enabled:true}},{plugins:[{name:'vite:oxc'}]});
 assert.equal(context,null);assert.equal(starts,0);
});
