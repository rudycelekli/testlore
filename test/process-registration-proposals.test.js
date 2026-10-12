import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {processRegistrationProposals,validateProcessRegistrationProposals,inspectProcessRegistrationProposalEnvelope} from '../src/process-registration-proposals.js';
import {plan} from '../src/selector.js';
import {fixture} from './helpers.js';
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
// Constructed REA-shaped source controls, not native upstream qualification.
const producer=`import {McpServer} from '@modelcontextprotocol/server';
const mode=process.env.REA_FAKE_JADX_MODE ?? 'normal';
const server=new McpServer({name:'fixture',version:'1'});
const json=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const register=(name,handler)=>server.registerTool(name,{},handler);
register('status',()=>json({mode}));`;
const launcher=`import {fileURLToPath} from 'node:url';
import {spawnOwnedProviderProcess} from '../../src/process/Owned.js';
const fixture=fileURLToPath(new URL('./mcp.mjs',import.meta.url));
export const launch=async(mode,options)=>spawnOwnedProviderProcess({
...options,command:process.execPath,arguments:[fixture],
env:{...options.env,REA_FAKE_JADX_MODE:mode}});`;
function graph(){return {
 sources:{'tests/fixtures/mcp.mjs':producer,'tests/fixtures/launcher.ts':launcher,
 'src/process/Owned.ts':`import {spawn} from 'node:child_process'; export const spawnOwnedProviderProcess=options=>spawn(options.command,options.arguments,options);`,
 'tests/actual.test.ts':`import {launch} from './fixtures/launcher.js'; await launch('normal',{});`,
 'tests/excluded.test.ts':`import {launch} from './fixtures/launcher.js'; await launch('error',{});`,
 'tests/fake.test.ts':`const fake={command:'fixture',arguments:[]};`},
 edges:{'tests/actual.test.ts':['tests/fixtures/launcher.ts'],'tests/excluded.test.ts':['tests/fixtures/launcher.ts'],'tests/fixtures/launcher.ts':['src/process/Owned.ts'],'tests/fake.test.ts':[]},
 tests:['tests/actual.test.ts','tests/fake.test.ts'],warnings:[{file:'tests/fixtures/mcp.mjs',reason:'runtime-registration'}]};}
const receipt=()=>({runtime:{kind:'node',version:'v22.19.0',executableSha256:digest('owned executable')},inputs:[{name:'env:REA_FAKE_JADX_MODE',sha256:digest('normal')}]});

test('composes lexical owner, literal URL, source-bound argv sink and distinct native/excluded consumers',()=>{
 const g=graph(),before=JSON.stringify(g),report=processRegistrationProposals(g),p=report.proposals[0];
 assert.equal(p.stateOwners[0].receiver,'server');
 assert.equal(p.stateOwners[0].constructor.import.specifier,'@modelcontextprotocol/server');
 assert.equal(p.launches.length,1);assert.equal(p.launches[0].source,'tests/fixtures/launcher.ts');
 assert.equal(p.launches[0].sink.file,'src/process/Owned.ts');
 assert.equal(p.launches[0].sink.sourceSha256,digest(g.sources['src/process/Owned.ts']));
 assert.deepEqual(p.discoveredConsumerCandidates.map(item=>item.file),['tests/actual.test.ts']);
 assert.deepEqual(p.excludedConsumerCandidates.map(item=>item.file),['tests/excluded.test.ts']);
 assert.ok(p.launches[0].uncertainties.includes('inherited-process-options'));
 assert.ok(p.launches[0].uncertainties.includes('inherited-environment'));
 assert.ok(p.launches[0].uncertainties.includes('dynamic-environment-value'));
 assert.ok(p.uncertainties.includes('runtime-executable-unbound'));
 assert.ok(p.uncertainties.includes('effective-process-inputs-unbound'));
 assert.deepEqual(report.existingUncertainties,g.warnings);
 assert.equal(JSON.stringify(g),before);assert.equal(report.omissionAuthority,false);
 assert.equal(validateProcessRegistrationProposals(report,g).qualified,false);
 assert.match(p.nextAction,/independently challenge/);
});

test('caller receipts bind bytes without claiming complete inputs, isolation or qualified execution',()=>{
 const g=graph(),r=receipt(),report=processRegistrationProposals(g,r);
 assert.equal(validateProcessRegistrationProposals(report,g,r).valid,true);
 assert.ok(report.proposals[0].uncertainties.includes('consumer-completeness-unproven'));
 assert.ok(report.proposals[0].launches[0].uncertainties.includes('effective-cwd-unbound'));
 assert.ok(report.proposals[0].launches[0].uncertainties.includes('inherited-environment'));
 assert.equal(report.closedWorld,false);assert.equal(report.reviewRequired,true);
 assert.equal(report.proposals[0].authority,'diagnostic-only');
 assert.equal(report.proposals[0].patch,undefined);
});

test('changed fixture, lexical state, sink implementation, consumer, graph, runtime and input receipts reject freshness',()=>{
 const changes=[g=>g.sources['tests/fixtures/mcp.mjs']+='\nconst alias=register;',g=>g.sources['src/process/Owned.ts']+='\n// revised implementation',g=>g.sources['tests/actual.test.ts']+='\n// changed case',g=>g.edges['tests/actual.test.ts']=[],g=>g.tests.push('tests/excluded.test.ts'),g=>g.warnings.push({file:'tests/fake.test.ts',reason:'dynamic-dependency'})];
 for(const change of changes){const g=graph(),r=receipt(),report=processRegistrationProposals(g,r);change(g);assert.throws(()=>validateProcessRegistrationProposals(report,g,r),/changed/);}
 for(const change of [r=>r.runtime.version='v22.22.0',r=>r.runtime.executableSha256=digest('different'),r=>r.inputs[0].sha256=digest('error')]){const g=graph(),r=receipt(),report=processRegistrationProposals(g,r);change(r);assert.throws(()=>validateProcessRegistrationProposals(report,g,r),/changed/);}
});

test('tampered output and a resealed invented consumer cannot pass independent recomputation',()=>{
 const g=graph(),report=processRegistrationProposals(g);report.omissionAuthority=true;
 assert.throws(()=>validateProcessRegistrationProposals(report,g),/integrity/);
 const fabricated=processRegistrationProposals(g);fabricated.proposals[0].consumers.push({file:'tests/fake.test.ts',sourceSha256:digest(g.sources['tests/fake.test.ts']),paths:[]});
 const {integrity,...payload}=fabricated;fabricated.integrity=digest(payload);
 assert.throws(()=>validateProcessRegistrationProposals(fabricated,g),/changed/);
});

test('aliased sinks, unknown implementations and additional dynamic argv retain uncertainties',()=>{
 for(const mutate of [g=>g.sources['tests/fixtures/launcher.ts']=launcher.replace('export const launch=','const delegated=spawnOwnedProviderProcess; export const launch=').replace('=>spawnOwnedProviderProcess({','=>delegated({'),g=>delete g.sources['src/process/Owned.ts'],g=>g.sources['tests/fixtures/launcher.ts']=launcher.replace('arguments:[fixture]','arguments:[fixture,options.argument]')]){
  const g=graph();mutate(g);const p=processRegistrationProposals(g).proposals[0];
  assert.ok(p.launches[0].uncertainties.some(value=>/aliased|unavailable|dynamic-argv/.test(value)));assert.equal(p.omissionAuthority,false);
 }
 const g=graph();g.sources['tests/fixtures/mcp.mjs']+='\nconst alias=register;';
 assert.ok(processRegistrationProposals(g).proposals[0].uncertainties.includes('registration-helper-alias-or-escape'));
});

test('shadowed or aliased URL conversion, dynamic paths and escaped paths never fabricate a launch',()=>{
 const mutations=[value=>value.replace('export const launch=','function local(URL){}; export const launch='),value=>`import * as URL from 'untrusted';\n${value}`,value=>`import URL from 'untrusted';\n${value}`,value=>value.replace('export const launch=','globalThis.URL=UnknownURL; export const launch='),value=>value.replace('{fileURLToPath}','{fileURLToPath as convert}').replace('=fileURLToPath(','=convert('),value=>value.replace("'./mcp.mjs'",'process.env.FIXTURE'),value=>value.replace("'./mcp.mjs'","'../../../../mcp.mjs'"),value=>value.replace("'./mcp.mjs'","'./mcp.mjs?query'")];
 for(const mutate of mutations){const g=graph();g.sources['tests/fixtures/launcher.ts']=mutate(launcher);const p=processRegistrationProposals(g).proposals[0];assert.equal(p.launches.length,0);assert.ok(p.uncertainties.includes('fixture-launch-consumers-unresolved'));}
 const g=graph();g.sources['tests/fixtures/launcher.ts']=launcher.replace('export const launch=','const process={execPath:()=>0}; export const launch=');
 assert.ok(processRegistrationProposals(g).proposals[0].launches[0].uncertainties.includes('unknown-or-shadowed-executable'));
});

test('malformed source, unknown state receiver and missing producers remain explicit',()=>{
 const g=graph();g.sources['tests/fixtures/mcp.mjs']='const register=(name,handler)=>unknown.registerTool(name,{},handler); register("tool",()=>0);';
 assert.ok(processRegistrationProposals(g).proposals[0].uncertainties.includes('registration-state-owner-unresolved'));
 g.sources['tests/fixtures/mcp.mjs']='const = ;';
 assert.ok(processRegistrationProposals(g).diagnostics.some(item=>item.reason==='source-parse-incomplete'));
 delete g.sources['tests/fixtures/mcp.mjs'];
 assert.ok(processRegistrationProposals(g).diagnostics.some(item=>item.reason==='registration-source-unavailable'));
});

test('budget violations, unsafe paths and fabricated runtime/input shapes reject boundedly',()=>{
 for(const change of [g=>g.sources['../escape.js']='x',g=>g.sources['oversize.js']='x'.repeat(524289),g=>g.edges['tests/actual.test.ts']=['../outside'],g=>g.tests=Array(1001).fill('tests/actual.test.ts')]){const g=graph();change(g);assert.throws(()=>processRegistrationProposals(g));}
 for(const r of [{runtime:{kind:'node',version:'v22',executableSha256:'wrong'}},{inputs:[{name:'env:MODE',sha256:digest('x'),value:'private'}]},{inputs:Array(257).fill({name:'env:MODE',sha256:digest('x')})},{runtime:receipt().runtime,authority:true}])assert.throws(()=>processRegistrationProposals(graph(),r));
});

test('diagnosis does not narrow global registration fallback on an independent consumer',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/registration.js':`const server={registerTool(){globalThis.shared='broken'}};const register=(name,handler)=>server.registerTool(name,{},handler);register('tool',()=>0);`,'test/affected.test.js':`import '../src/registration.js';`,'test/independent.test.js':`import assert from 'node:assert/strict';assert.equal(globalThis.shared,'healthy');`});
 const selection=plan(root,{changed:['src/registration.js']});
 assert.deepEqual(selection.selected,['test/affected.test.js','test/independent.test.js']);
});

test('an imported no-op with fixture argv never declares observed execution or actual consumers',()=>{
 const g=graph();g.sources['src/process/Owned.ts']='export const spawnOwnedProviderProcess=options=>({note:"no launch",options});';
 const p=processRegistrationProposals(g).proposals[0];
 assert.deepEqual(p.consumers,[]);
 assert.equal(p.launches[0].executionObserved,false);
 assert.equal(p.launches[0].kind,'imported-call-with-fixture-argv-candidate');
 assert.ok(p.launches[0].uncertainties.includes('effective-launch-not-established-by-static-source'));
 assert.equal(p.discoveredConsumerCandidates[0].evidenceScope,'static-import-path-only');
});

test('zero registration skips AST diagnosis even for invalid large source',()=>{
 const g=graph();g.warnings=[];g.sources['large.ts']='const = ;\n'.repeat(20000);
 const report=processRegistrationProposals(g);
 assert.deepEqual(report.proposals,[]);assert.deepEqual(report.diagnostics,[]);
 assert.equal(report.sourceBindings['large.ts'],digest(g.sources['large.ts']));
});

test('multiple individually small sources exhaust one shared aggregate AST budget',()=>{
 const g=graph();
 for(let i=0;i<8;i++)g.sources[`candidate${i}.ts`]='// fileURLToPath arguments: candidate\n'+Array.from({length:6000},(_,n)=>`const value${n}=0;`).join('\n');
 assert.throws(()=>processRegistrationProposals(g),/aggregate syntax traversal budget/);
});

test('irrelevant registration sources retain uncertainty without spending AST work on owner declarations',()=>{
 const g=graph();
 for(let i=0;i<20;i++){
  const file=`src/unrelated-registry${i}.ts`;
  g.sources[file]=Array.from({length:4000},(_,n)=>`const value${n}=/\\d+/;`).join('\n');
  g.warnings.push({file,reason:'runtime-registration',scope:'global'});
 }
 const result=processRegistrationProposals(g);
 assert.equal(result.proposals.find(item=>item.fixture==='tests/fixtures/mcp.mjs').launches.length,1);
 assert.deepEqual(result.existingUncertainties,g.warnings);
 for(const item of result.proposals.filter(item=>item.fixture.startsWith('src/unrelated'))){
  assert.deepEqual(item.stateOwners,[]);assert.deepEqual(item.consumers,[]);
  assert.ok(item.uncertainties.includes('registration-state-not-analyzed-without-static-launch'));
  assert.equal(result.sourceBindings[item.fixture],digest(g.sources[item.fixture]));
 }
});

test('comment-separated, quoted and escaped argv names preserve the same static candidate',()=>{
 for(const property of ['arguments /* source-owned comment */ :', '"arguments":', '\\u0061rguments:', '"arg\\u0075ments":']){
  const g=graph();g.sources['tests/fixtures/launcher.ts']=launcher.replace('arguments:',property);
  assert.equal(processRegistrationProposals(g).proposals[0].launches.length,1,property);
 }
 const escaped=graph();escaped.sources['tests/fixtures/launcher.ts']=launcher.replaceAll('fileURLToPath','\\u0066ileURLToPath');
 assert.equal(processRegistrationProposals(escaped).proposals[0].launches.length,1);
 const g=graph();g.sources['tests/fixtures/launcher.ts']=launcher.replace('arguments:','["arguments"]:');
 const result=processRegistrationProposals(g);
 assert.equal(result.proposals[0].launches.length,0);
 assert.ok(result.diagnostics.some(item=>item.reason==='computed-process-options-not-indexed'));
 assert.ok(result.proposals[0].uncertainties.includes('fixture-launch-consumers-unresolved'));
});

test('repeated lexical-state arrays refuse before expanded owner serialization',()=>{
 const g=graph();
 g.sources['tests/fixtures/mcp.mjs']=`import {McpServer} from '@modelcontextprotocol/server'; const server=new McpServer({});`+Array.from({length:120},(_,n)=>`const helper${n}=()=>server.registerTool('tool',{},()=>0);`).join('\n');
 assert.throws(()=>processRegistrationProposals(g),/output budget exceeded/);
});

test('multi-fixture launch expansion refuses before repeated proposals are serialized',()=>{
 const g=graph(),file='tests/fixtures/launcher.ts',references=[];
 for(let i=0;i<31;i++){
  const fixture=`tests/fixtures/${'fixture'.repeat(100)}${i}.mjs`;
  g.sources[fixture]=producer;g.warnings.push({file:fixture,reason:'runtime-registration',scope:'global'});
  const name=`fixture${i}`;references.push(name);
  g.sources[file]+=`\nconst ${name}=fileURLToPath(new URL('./${fixture.split('/').at(-1)}',import.meta.url));`;
 }
 g.sources[file]+='\n'+`spawnOwnedProviderProcess({command:process.execPath,arguments:[fixture,${references.join(',')}]});`.repeat(20);
 assert.throws(()=>processRegistrationProposals(g),/output budget exceeded/);
});

test('memoized paths still charge every emitted chain against shared consumer work',()=>{
 const g=graph(),file='tests/fixtures/launcher.ts';
 // Each distinct candidate call reaches the same cached long chain. Its output
 // still costs work; cache reuse must not hide serialization expansion.
 g.sources[file]=launcher.replace('export const launch=async(mode,options)=>','export const launch=async(mode,options)=>');
 const call="spawnOwnedProviderProcess({command:process.execPath,arguments:[fixture]});";
 g.sources[file]+='\n'+call.repeat(200);
 let previous='tests/actual.test.ts';g.edges[previous]=['chain0.ts'];
 for(let i=0;i<600;i++){const item=`chain${i}.ts`;g.sources[item]='export const value=0;';g.edges[item]=[i===599?file:`chain${i+1}.ts`];}
 assert.throws(()=>processRegistrationProposals(g),/aggregate consumer traversal budget/);
});

test('shared wide graph is indexed once per launch source without exhausting the work cap',()=>{
 const g=graph();g.sources['wide.ts']='export const wide=true;';g.edges['wide.ts']=[];
 for(let i=0;i<500;i++){const file=`module${i}.ts`;g.sources[file]='export const value=0;';g.edges['wide.ts'].push(file);}
 for(let i=0;i<200;i++){const file=`tests/wide${i}.test.ts`;g.sources[file]=`import '../wide.js';`;g.edges[file]=['wide.ts'];g.tests.push(file);}
 g.edges['module499.ts']=['tests/fixtures/launcher.ts'];
 const result=processRegistrationProposals(g),p=result.proposals[0];
 assert.equal(p.discoveredConsumerCandidates.length,201);
 assert.deepEqual(p.discoveredConsumerCandidates.find(item=>item.file==='tests/wide0.test.ts').paths[0].chain,['tests/wide0.test.ts','wide.ts','module499.ts','tests/fixtures/launcher.ts']);
 assert.deepEqual(p.consumers,[]);assert.deepEqual(result.existingUncertainties,g.warnings);
 assert.equal(result.omissionAuthority,false);
});

test('many distinct launch sources retain one shared traversal budget',()=>{
 const g=graph(),targets=['tests/fixtures/launcher.ts'];
 for(let i=0;i<24;i++){
  const file=`tests/fixtures/launcher${i}.ts`;g.sources[file]=launcher;g.edges[file]=['src/process/Owned.ts'];targets.push(file);
 }
 for(let i=0;i<3000;i++){
  const file=`wide${i}.ts`;g.sources[file]='export const value=0;';g.edges[file]=i===0?targets:[`wide${i-1}.ts`];
 }
 g.edges['tests/actual.test.ts']=['wide2999.ts'];
 assert.throws(()=>processRegistrationProposals(g),/aggregate consumer traversal budget/);
});

test('reverse next-hop paths are deterministic, cycle-safe and bound to actual edges',()=>{
 const g=graph(),source='tests/fixtures/launcher.ts';
 for(const file of ['path-a.ts','path-b.ts','cycle.ts'])g.sources[file]='export const value=0;';
 g.edges['tests/actual.test.ts']=['path-b.ts','path-a.ts'];
 g.edges['path-a.ts']=[source,'cycle.ts'];g.edges['path-b.ts']=[source];g.edges['cycle.ts']=['path-a.ts'];
 const result=processRegistrationProposals(g),chain=result.proposals[0].discoveredConsumerCandidates[0].paths[0].chain;
 assert.deepEqual(chain,['tests/actual.test.ts','path-a.ts',source]);
 for(let i=0;i<chain.length-1;i++)assert.ok(g.edges[chain[i]].includes(chain[i+1]));
 const changed=graph();changed.sources=g.sources;changed.edges={...g.edges,'path-a.ts':['cycle.ts']};
 assert.throws(()=>validateProcessRegistrationProposals(result,changed),/source, producer, graph/);
 assert.deepEqual(processRegistrationProposals(changed).proposals[0].discoveredConsumerCandidates[0].paths[0].chain,['tests/actual.test.ts','path-b.ts',source]);
});

test('offline envelope inspection checks seal, producer, authority and sources without semantic execution',()=>{
 const g=graph(),report=processRegistrationProposals(g),fresh=Object.fromEntries(Object.entries(g.sources).map(([file,text])=>[file,digest(text)]));
 const inspected=inspectProcessRegistrationProposalEnvelope(report,fresh);
 assert.equal(inspected.semanticRevalidation,false);assert.equal(inspected.qualified,false);assert.equal(inspected.requiresFreshGraphAndLaunchInputs,true);
 assert.equal(inspectProcessRegistrationProposalEnvelope(report).sourceBindingsChecked,false);
 const modified={...fresh,'tests/fixtures/mcp.mjs':digest('changed')};assert.throws(()=>inspectProcessRegistrationProposalEnvelope(report,modified),/source binding changed/);
 for(const change of [r=>r.omissionAuthority=true,r=>r.proposals[0].consumers.push({file:'tests/fake.test.ts'}),r=>r.proposals[0].launches[0].executionObserved=true,r=>r.proposals[0].sourceSha256=digest('changed'),r=>r.qualified=true,r=>r.producer.sha256=digest('changed producer')]){
  const forged=processRegistrationProposals(g);change(forged);const {integrity,...payload}=forged;forged.integrity=digest(payload);
  assert.throws(()=>inspectProcessRegistrationProposalEnvelope(forged,fresh));
 }
});
