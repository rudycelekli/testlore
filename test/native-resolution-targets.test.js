import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeResolutionPass} from '../src/native-resolution-targets.js';
const container=(name,events)=>({async resolveId(specifier,importer,options){events.push({name,specifier,importer,ssr:options.ssr});return {id:`/${name}/${options.ssr?'ssr':'client'}/${specifier}`};}});
test('identical live container and mode are consulted once per request, preserving client and SSR',async()=>{
 const events=[],shared=container('same',events),pass=createNativeResolutionPass([{pluginContainer:shared},{pluginContainer:shared},{pluginContainer:shared}]);
 const result=await pass.resolve('@subject','/src/caller.js');assert.equal(result.length,2);assert.deepEqual(events.map(event=>event.ssr),[false,true]);
 assert.deepEqual(pass.diagnostics(),{schemaVersion:2,policy:'same-live-container-object-and-ssr-per-request',projectServers:3,projectServerObservations:3,requestedPairs:6,uniquePairs:2,requestCount:1,callCount:2,avoidedPairCalls:4,crossRequestCache:false});
});
test('separate project aliases remain separate despite identical names or apparent configuration',async()=>{
 const events=[],alpha=container('alpha',events),beta=container('beta',events);
 const result=await createNativeResolutionPass([{pluginContainer:alpha},{pluginContainer:beta}]).resolve('@subject','/src/caller.js');
 assert.equal(result.length,4);assert.deepEqual(result.map(row=>row.id),['/alpha/client/@subject','/alpha/ssr/@subject','/beta/client/@subject','/beta/ssr/@subject']);
});
test('actual SSR environment containers and a missing project resolution are retained',async()=>{
 const events=[],client=container('client',events),ssr=container('ssr',events),missing={resolveId:async()=>null};
 const pass=createNativeResolutionPass([{pluginContainer:client,environments:{ssr:{pluginContainer:ssr}}},{pluginContainer:missing}]);
 const result=await pass.resolve('missing-or-aliased','/caller.js');assert.equal(result.length,4);assert.equal(result.filter(row=>row===null).length,2);assert.deepEqual(events.map(row=>[row.name,row.ssr]),[['client',false],['ssr',true]]);
});
test('repeated requests, different importers and fresh phases never reuse native outcomes',async()=>{
 let revision=1,calls=0;const live={async resolveId(specifier,importer,{ssr}){calls++;return {id:`/${revision}/${importer}/${ssr}/${specifier}`};}};
 const pass=createNativeResolutionPass([{pluginContainer:live},{pluginContainer:live}]);const first=await pass.resolve('pkg','a');revision=2;const next=await pass.resolve('pkg','a');const other=await pass.resolve('pkg','b');
 assert.notDeepEqual(first,next);assert.notDeepEqual(next,other);assert.equal(calls,6);assert.equal(pass.diagnostics().requestCount,3);
 const fresh=createNativeResolutionPass([{pluginContainer:live},{pluginContainer:live}]);await fresh.resolve('pkg','a');assert.equal(calls,8);assert.equal(fresh.diagnostics().callCount,2);
});
test('distinct SSR modes remain distinct even when every project reuses the same container',async()=>{
 const events=[],shared=container('shared',events);const pass=createNativeResolutionPass([{pluginContainer:shared,environments:{ssr:{pluginContainer:shared}}},{pluginContainer:shared,environments:{ssr:{pluginContainer:shared}}}]);
 await pass.resolve('conditional','/caller.js');assert.equal(events.length,2);assert.equal(pass.diagnostics().uniquePairs,2);
});
test('bounded diagnostics count attempted calls and do not turn resolver failures into usable edges',async()=>{
 const pass=createNativeResolutionPass([{pluginContainer:{resolveId:async()=>{throw Error('native failed');}}}]);await assert.rejects(pass.resolve('pkg','/caller.js'),/native failed/);assert.equal(pass.diagnostics().callCount,1);
 assert.equal(pass.diagnostics().requestedPairs,1);assert.equal(pass.diagnostics().uniquePairs,1);assert.equal(pass.diagnostics().avoidedPairCalls,0);
 assert.throws(()=>createNativeResolutionPass(Array(130).fill({})),/Unbounded/);await assert.rejects(createNativeResolutionPass([{}]).resolve('pkg','/caller.js'),/Missing/);
});
test('replacing client and SSR container bindings between requests preserves new alias and missing results',async()=>{
 const events=[],old=container('old',events),client=container('new-client',events),ssr={resolveId:async()=>null};
 const first={pluginContainer:old},second={pluginContainer:old};
 const pass=createNativeResolutionPass([first,second]);
 assert.equal((await pass.resolve('@subject','/caller.js')).length,2);
 first.pluginContainer=client;first.environments={ssr:{pluginContainer:ssr}};
 const changed=await pass.resolve('@subject','/caller.js');
 assert.deepEqual(changed.map(row=>row?.id??null),['/new-client/client/@subject',null,'/old/client/@subject','/old/ssr/@subject']);
 assert.deepEqual(pass.diagnostics(),{schemaVersion:2,policy:'same-live-container-object-and-ssr-per-request',projectServers:2,projectServerObservations:4,requestedPairs:8,uniquePairs:6,requestCount:2,callCount:6,avoidedPairCalls:2,crossRequestCache:false});
});
test('project server replacement and changing server count are read from the live provider on each request',async()=>{
 const events=[],old=container('old',events),fresh=container('fresh',events);let projects=[{vite:{pluginContainer:old}}],reads=0;
 const pass=createNativeResolutionPass(()=>{reads++;return projects.map(project=>project.vite);});
 await pass.resolve('pkg','/caller.js');projects=[{vite:{pluginContainer:fresh}},{vite:{pluginContainer:fresh}}];
 assert.deepEqual((await pass.resolve('pkg','/caller.js')).map(row=>row.id),['/fresh/client/pkg','/fresh/ssr/pkg']);
 assert.equal(reads,2);assert.equal(pass.diagnostics().projectServerObservations,3);assert.equal(pass.diagnostics().requestedPairs,6);assert.equal(pass.diagnostics().uniquePairs,4);assert.equal(pass.diagnostics().avoidedPairCalls,2);
 projects=Array(130).fill({});await assert.rejects(pass.resolve('pkg','/caller.js'),/Unbounded/);
});
test('a binding replaced during an awaited resolution is read before the next pair',async()=>{
 const events=[],fresh=container('fresh',events);const server={};
 server.pluginContainer={async resolveId(specifier,importer,{ssr}){assert.equal(ssr,false);server.pluginContainer=fresh;return {id:'/old/client/pkg'};}};
 const result=await createNativeResolutionPass([server]).resolve('pkg','/caller.js');
 assert.deepEqual(result.map(row=>row.id),['/old/client/pkg','/fresh/ssr/pkg']);
});
