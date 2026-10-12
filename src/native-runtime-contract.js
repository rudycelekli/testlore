// This is an intentionally narrow qualification of one reviewed installation.
// Captured JSON is diagnostic evidence. Only the parent's private live session
// can admit runtime closure, after its own fresh source/installation capture.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {captureUnimportRuntimeEvidence,assertFreshUnimportRuntimeEvidence} from './unimport-runtime-evidence.js';
import {isReviewedUnimportFactoryPlugin} from './vitest-case-contracts.js';
import TestLoreVitestCaseReporter from './reporters/vitest-cases.js';
const contexts=new WeakMap();
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const NODE_SHA='0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1';
// This pin is set only after actual original-environment implementation review
// and independent native canaries. Arbitrary freshly installed bytes do not pass.
const IMPLEMENTATION_SHA='7058ed2febd3328c9022201e2fe590ab075d70e0ff568c39a2b7db62f4bae006';
const DIRECTORIES_SHA='ab1ecbdb5a451319309c9f954873c3bc6357bc27b1b8a10f7094f42148896350';
const EFFECTIVE_SHA='62fb647f439e4619005f176d3754fd584531c84790eab7f8e098eeef1abc3a13';
const EFFECTIVE_CI_SHA='efc600c8089d7be224b7e05c8c82161d8aaae0496f0ddf1ec3436004a3c6b3ea';
const effectivePin=inventory=>inventory.environment?.CI==='true'?EFFECTIVE_CI_SHA:inventory.environment?.CI===null?EFFECTIVE_SHA:null;
const CANARIES_SHA='07e216395b1ae6f50be2afc3887e818e2d63b6fdc287906bceff69d9741db590';
const PROFILE='original-unimport-node22-oxc-runtime-v1';
const environments=['__vitest__','client','ssr'];
const bindingFiles=['node_modules/.pnpm/@rolldown+binding-darwin-arm64@1.2.7/node_modules/@rolldown/binding-darwin-arm64/rolldown-binding.darwin-arm64.node','node_modules/.pnpm/fsevents@2.3.3/node_modules/fsevents/fsevents.node'];
function nativeEnvironment(){return process.platform==='darwin'&&process.arch==='arm64'&&(process.env.CI===undefined||process.env.CI==='true')&&process.execArgv.length===0&&process.env.NODE_ENV==='test'&&process.env.TEST==='true'&&process.env.VITEST==='true'&&!Object.keys(process.env).some(key=>key!=='NODE_ENV'&&/^(?:NODE_|NAPI_|OXC_|ROLLDOWN_|VITE_|TS_NODE)/.test(key));}
function nativeBindings(root,command,inventory){
 const loaded=Object.keys(createRequire(command[1]).cache).filter(file=>file.endsWith('.node')).sort();
 if(JSON.stringify(loaded)!==JSON.stringify(bindingFiles.map(file=>path.join(root,file)).sort()))throw Error('Unreviewed loaded native binding');
 return bindingFiles.map(file=>{const row=inventory.installedInputs.find(input=>input.file===file&&input.kind==='file');if(!row||hash(fs.readFileSync(path.join(root,file)))!==row.sha256)throw Error('Loaded native binding bytes changed');return {file,sha256:row.sha256};});
}
const canarySources={declaration:"import type { Stats } from 'node:fs'; export const value=1;",inline:"import {type Stats} from 'node:fs'; export const value=1;",mixed:"import {type Stats,readFileSync} from 'node:fs'; export const value=readFileSync;",sideeffect:"import 'node:fs'; export const value=1;",exporttype:"export type { Stats } from 'node:fs'; export const value=1;"};
function supportedInventory(value){return value?.schemaVersion===1&&value.profile==='original-unimport-runtime-facts-v1'&&effectivePin(value)!==null&&value.nodeIdentity?.version==='v22.19.0'&&value.nodeIdentity.sha256===NODE_SHA&&Array.isArray(value.installedInputs)&&value.installedInputs.length<=100000&&value.installationContract?.profile==='original-unimport-pnpm12-bookkeeping-v1'&&value.installationContract.implementationSha256===IMPLEMENTATION_SHA&&hash(value.installedInputs.map(row=>value.installationContract.metadata?.find(input=>input.file===row.file)??row))===IMPLEMENTATION_SHA&&Array.isArray(value.installedDirectories)&&value.installedDirectories.length<=100000&&hash(value.installedDirectories)===DIRECTORIES_SHA&&Array.isArray(value.configurationInputs)&&value.configurationInputs.find(row=>row.file==='vitest.config.ts')?.sha256==='4c2858817158e50b11f7d60a0c658ce54cfba14d707dea42f31b1477fca9a4ac';}
function constructorOptions(root,profile,options,overrides){
 const allowed=new Set(['--','color','config','c','root','run','watch','includeTaskLocation','reporters','outputFile','cache']);
 if(Object.keys(options).some(key=>!allowed.has(key))||Object.keys(overrides).sort().join(',')!=='logLevel,plugins'||overrides.logLevel!=='silent'||options.cache!==false||options.run!==true||options.watch!==false||options.includeTaskLocation!==true||options.root!==undefined&&options.root!==root||options['--']!==undefined&&(!Array.isArray(options['--'])||options['--'].length)||options.color!==undefined&&typeof options.color!=='boolean')return false;
 const config=path.join(root,profile.observerConfiguration.file);
 if(typeof options.config!=='string'||path.resolve(root,options.config)!==config||options.c!==undefined&&path.resolve(root,options.c)!==config)return false;
 if(options.reporters!==undefined&&(!Array.isArray(options.reporters)||options.reporters.length!==2||options.reporters[0]!=='json'||!(options.reporters[1] instanceof TestLoreVitestCaseReporter)))return false;
 if(options.outputFile!==undefined&&(typeof options.outputFile!=='string'||!path.isAbsolute(options.outputFile)))return false;
 return Array.isArray(overrides.plugins)&&overrides.plugins.length===1&&isReviewedUnimportFactoryPlugin(overrides.plugins[0],root,profile.registrationContracts[0]);
}
function primitive(value,root,depth=0,seen=new Set()){
 if(depth>15)throw Error('Unbounded runtime options');
 if(typeof value==='string')return value.replaceAll(root,'<project>');
 if(value===null||['number','boolean','undefined'].includes(typeof value))return value??null;
 if(typeof value==='function')return {functionSha256:hash(Function.prototype.toString.call(value))};
 if(value instanceof RegExp)return {regexp:value.source,flags:value.flags};
 if(typeof value!=='object'||seen.has(value))throw Error('Unsupported runtime options');
 seen.add(value);let result;
 if(Array.isArray(value))result=value.map(item=>primitive(item,root,depth+1,seen));
 else{result={};for(const key of Object.keys(value).sort()){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)throw Error('Missing runtime options descriptor');result[key]=Object.hasOwn(descriptor,'value')?primitive(descriptor.value,root,depth+1,seen):{getterSha256:typeof descriptor.get==='function'?hash(Function.prototype.toString.call(descriptor.get)):null,setterSha256:typeof descriptor.set==='function'?hash(Function.prototype.toString.call(descriptor.set)):null,value:primitive(value[key],root,depth+1,seen)};}}
 seen.delete(value);return result;
}
function pluginSnapshot(context){
 const lists=[context.vite.config.plugins,context.vite.config.inlineConfig.plugins,...Object.values(context.projects[0].vite.environments).map(environment=>environment.config.plugins)];
 const objects=new Map();
 function walk(value,depth){if(!value||!['object','function'].includes(typeof value)||objects.has(value)||depth>5)return;const descriptors=Object.getOwnPropertyDescriptors(value);objects.set(value,descriptors);for(const descriptor of Object.values(descriptors))if(Object.hasOwn(descriptor,'value')&&typeof descriptor.value!=='function')walk(descriptor.value,depth+1);}
 for(const list of lists)walk(list,0);
 return ()=>{for(const [object,descriptors] of objects){const current=Object.getOwnPropertyDescriptors(object),keys=Reflect.ownKeys(descriptors),actual=Reflect.ownKeys(current);if(keys.length!==actual.length||keys.some(key=>!actual.includes(key)||Object.keys(descriptors[key]).some(field=>!Object.is(descriptors[key][field],current[key]?.[field]))))throw Error('Observed native plugin identity or hook changed');}};
}
export function observeUnimportRuntimeOptions(context,root,profile){
 if(context.projects.length!==1)throw Error('Runtime precision requires exactly one native project');
 const project=context.projects[0],config=project.config,vite=project.vite.config;
 if(context.cache?.results?.getCachePath()!==null||config.cache!==false)throw Error('Native writable results cache must be disabled');
 if(project!==context.getRootProject()||config.name!==''||config.root!==root||config.environment!=='node'||config.pool!=='forks'||config.isolate!==true||config.typecheck?.enabled!==false||config.browser?.enabled!==false||config.coverage?.enabled!==false||config.setupFiles?.length||config.globalSetup?.length||config.execArgv?.length||config.deps?.optimizer?.client?.enabled!==false||config.deps?.optimizer?.ssr?.enabled!==false||config.env&&Object.keys(config.env).length||config.provide&&Object.keys(config.provide).length)throw Error('Unsupported effective native test options');
 if(Object.keys(project.vite.environments).sort().join(',')!==environments.join(',')||vite.configFile!==path.join(root,profile.observerConfiguration.file)||[...new Set(vite.configFileDependencies)].sort().join('\n')!==[path.join(root,'vitest.config.ts'),path.join(root,profile.observerConfiguration.file)].sort().join('\n'))throw Error('Incomplete effective native configuration/environment closure');
 const originalFields=['cache','environmentOptions','typecheck','browser','pool','isolate','setupFiles','globalSetup','execArgv','deps','css','server','experimental','_moduleRunnerOptions','_scriptDefines','defines','snapshotSerializers','injectCjsGlobals','globals','viteOverrides','sharedViteServer'];
 const viteFields=['oxc','esbuild','ssr','resolve','define','mode','command','isProduction','env','json','assetsInclude','rawAssetsInclude','experimental','future','worker','envDir','publicDir','appType','cacheDir'];
 const testOptions=Object.fromEntries(originalFields.map(key=>[key,config[key]])),viteOptions=Object.fromEntries(viteFields.map(key=>[key,vite[key]]));
 const env=Object.fromEntries(environments.map(name=>{const value=project.vite.environments[name];if(value.config.consumer!==(name==='client'?'client':'server')||value.config.isBundled!==false)throw Error('Unsupported native transform environment');return [name,primitive({...value.config,plugins:value.config.plugins.map(plugin=>({name:plugin.name,keys:Object.keys(plugin).sort(),hooks:Object.fromEntries(Object.entries(plugin).filter(([,hook])=>typeof hook==='function').map(([key,hook])=>[key,hash(Function.prototype.toString.call(hook))]))}))},root)];}));
 return {testOptions:primitive(testOptions,root),viteOptions:primitive(viteOptions,root),environments:env,plugins:primitive(vite.plugins.map(plugin=>({name:plugin.name,keys:Object.keys(plugin).sort(),hooks:Object.fromEntries(Object.entries(plugin).filter(([,hook])=>typeof hook==='function').map(([key,hook])=>[key,hash(Function.prototype.toString.call(hook))]))})),root)};
}
async function transformCanaries(context,root){
 const rows=[];for(const name of environments){const environment=context.projects[0].vite.environments[name];for(const [kind,source]of Object.entries(canarySources)){const url='/src/utils.ts?testlore_runtime='+kind,id=path.join(root,'src/utils.ts')+'?testlore_runtime='+kind;await environment.moduleGraph.ensureEntryFromUrl(url);const result=await environment.pluginContainer.transform(source,id);const retains=result.code.includes('node:fs');if(!result.map||typeof result.code!=='string'||retains!==['mixed','sideeffect'].includes(kind))throw Error('Native type erasure canary differs');rows.push({environment:name,kind,id:'<project>/src/utils.ts?testlore_runtime='+kind,sourceSha256:hash(source),outputSha256:hash(result.code),mapSha256:hash(primitive(result.map,root)),retainsRuntime:retains});}}
 return rows;
}
/** Controlled construction is required; arbitrary native context objects cannot
 * acquire provenance, even when every plugin name and JSON field matches. */
export async function createObservedRuntimeContext(root,command,caseProfile,vitestModule,options,overrides){
 let inventory;try{if(caseProfile?.profile?.profile!=='unimport-detect-factory-runtime-v1'||!caseProfile.observerConfiguration||!constructorOptions(root,caseProfile,options,overrides)||!nativeEnvironment())return null;inventory=captureUnimportRuntimeEvidence(root,command,caseProfile);}catch{return null;}
 if(!supportedInventory(inventory))return null;
 const require=createRequire(command[1]),canonical=await import(pathToFileURL(require.resolve('vitest/node')).href);
 if(vitestModule.createVitest!==canonical.createVitest||vitestModule.parseCLI!==canonical.parseCLI)return null;
 const context=await canonical.createVitest(options,overrides);
 try{
  const projection=observeUnimportRuntimeOptions(context,root,caseProfile),checkPlugins=pluginSnapshot(context),bindings=nativeBindings(root,command,inventory);
  if(hash(projection)!==effectivePin(inventory))throw Error('Unreviewed effective transform profile');
  const canaries=await transformCanaries(context,root);checkPlugins();
  if(hash(canaries)!==CANARIES_SHA)throw Error('Unreviewed native transform canary outputs');
  assertFreshUnimportRuntimeEvidence(inventory);
  contexts.set(context,{root,command:[...command],caseProfile,inventory,projection,canaries,checkPlugins,bindings});
  return context;
 }catch(error){
  // Once executable configuration has run, retain the same native context as
  // conservative. Never evaluate configuration twice to recover authority.
  try{assertFreshUnimportRuntimeEvidence(inventory);}catch(freshnessError){await context.close();throw freshnessError;}
  return context;
 }
}

export function captureObservedRuntimeContract(context){
 const record=contexts.get(context);if(!record)return null;record.checkPlugins();
 if(!nativeEnvironment()||JSON.stringify(nativeBindings(record.root,record.command,record.inventory))!==JSON.stringify(record.bindings))throw Error('Native execution environment or binding changed');
 if(hash(observeUnimportRuntimeOptions(context,record.root,record.caseProfile))!==hash(record.projection))throw Error('Effective runtime transform options changed');
 assertFreshUnimportRuntimeEvidence(record.inventory);
 const value={schemaVersion:1,profile:PROFILE,inventoryDigest:record.inventory.digest,installedSha256:hash(record.inventory.installedInputs),implementationSha256:IMPLEMENTATION_SHA,installedDirectoriesSha256:DIRECTORIES_SHA,nodeSha256:NODE_SHA,nativeBindings:record.bindings,effective:record.projection,effectiveSha256:hash(record.projection),canaries:record.canaries,files:[...record.inventory.testFiles],closedConfigurationInputs:record.inventory.configurationInputs,observerConfiguration:record.inventory.observerConfiguration};return {...value,digest:hash(value)};
}
export function assertObservedRuntimeContract(context,prior){const current=captureObservedRuntimeContract(context);if(!current||JSON.stringify(prior)!==JSON.stringify(current))throw Error('Native runtime qualification changed');return current;}
/** This validates a private worker's corroborating projection against the
 * parent's freshly captured facts. Calling it with public JSON grants nothing. */
export function validateUnimportRuntimeContract(value,inventory){
 try{
 if(!supportedInventory(inventory)||!value||value.schemaVersion!==1||value.profile!==PROFILE||value.inventoryDigest!==inventory.digest||value.installedSha256!==hash(inventory.installedInputs)||value.implementationSha256!==IMPLEMENTATION_SHA||value.installedDirectoriesSha256!==DIRECTORIES_SHA||value.nodeSha256!==NODE_SHA||value.effectiveSha256!==effectivePin(inventory)||hash(value.effective)!==effectivePin(inventory)||JSON.stringify(value.files)!==JSON.stringify(inventory.testFiles)||JSON.stringify(value.closedConfigurationInputs)!==JSON.stringify(inventory.configurationInputs)||JSON.stringify(value.observerConfiguration)!==JSON.stringify(inventory.observerConfiguration))return null;
 if(JSON.stringify(value.nativeBindings)!==JSON.stringify(bindingFiles.map(file=>({file,sha256:inventory.installedInputs.find(input=>input.file===file)?.sha256}))))return null;
 assertFreshUnimportRuntimeEvidence(inventory);
 const {digest,...body}=value;if(Object.keys(value).sort().join(',')!=='canaries,closedConfigurationInputs,digest,effective,effectiveSha256,files,implementationSha256,installedDirectoriesSha256,installedSha256,inventoryDigest,nativeBindings,nodeSha256,observerConfiguration,profile,schemaVersion'||hash(body)!==digest||!Array.isArray(value.canaries)||value.canaries.length!==15||hash(value.canaries)!==CANARIES_SHA)return null;
 for(const [index,row]of value.canaries.entries()){const environment=environments[Math.floor(index/5)],kind=Object.keys(canarySources)[index%5];if(row.environment!==environment||row.kind!==kind||row.id!=='<project>/src/utils.ts?testlore_runtime='+kind||row.sourceSha256!==hash(canarySources[kind])||row.retainsRuntime!==['mixed','sideeffect'].includes(kind)||!['outputSha256','mapSha256'].every(key=>/^[a-f0-9]{64}$/.test(row[key])))return null;}
 return structuredClone(value);
 }catch{return null;}
}
