import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generate,callAgent} from '../src/swarm.js';
import {aqeCommand,aqeGenerate} from '../src/adapters/aqe.js';
import {validateCandidates} from '../src/candidates.js';
import {fixture,write,twoModules} from './helpers.js';
const review={accepted:true,findings:['Protocol fixture review, no model invoked.'],oracle:{independent:true,basis:['Written contract: a equals 1 and b equals 2.']}};
function setup(t,{enabled=true,tasks=['src/a.js'],mode='normal',reviewResult=review,command=['node','tools/aqe.cjs'],timeoutMs=5000}={}) {
 const worker=`import fs from 'node:fs';let input='';for await(const part of process.stdin)input+=part;const p=JSON.parse(input);fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/worker-payloads.jsonl',JSON.stringify({...p,observedAt:Date.now()})+'\\n');const result=p.role==='architect'?{tasks:${JSON.stringify(tasks.map(subject=>({subject,instructions:'Check written constant contract.'})))}}:p.role==='author'?{files:[{path:'test/worker.test.js',content:"import test from 'node:test';test('worker',()=>{});"}]}:${JSON.stringify(reviewResult)};process.stdout.write(JSON.stringify(result));`;
 const cli=`const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),a=process.argv.slice(2);fs.mkdirSync(path.join(root,'.tddswarm'),{recursive:true});fs.appendFileSync(path.join(root,'.tddswarm/aqe-calls.jsonl'),JSON.stringify({args:a,cwd:process.cwd(),openaiPresent:Boolean(process.env.OPENAI_API_KEY),anthropicPresent:Boolean(process.env.ANTHROPIC_API_KEY)})+'\\n');if(a.includes('--help')){console.log('generate --framework --format --output');process.exit(0);}const target=a[a.indexOf('generate')+1],name=path.basename(target,'.js'),mode=${JSON.stringify(mode)};if(mode==='overlap'||mode==='fallback-overlap'){fs.appendFileSync(path.join(root,'.tddswarm/aqe-events.jsonl'),JSON.stringify({target,event:'start',at:Date.now()})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);fs.appendFileSync(path.join(root,'.tddswarm/aqe-events.jsonl'),JSON.stringify({target,event:'end',at:Date.now()})+'\\n');if(mode==='fallback-overlap'&&name==='b')process.exit(7);}if(mode==='leak'){console.error(process.env.OPENAI_API_KEY);process.exit(7);}if(mode==='hung'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);return;}if(mode==='fail-second'&&name==='b')process.exit(7);if(mode==='binding-drift')fs.appendFileSync(__filename,'\\n// changed binding');if(mode==='drift')fs.writeFileSync(path.join(root,'src/a.js'),'export const a=999;');const file=mode==='identical'||mode==='conflict'?'test/shared.test.js':'test/aqe-'+name+'.test.js';let code="import test from 'node:test';import assert from 'node:assert/strict';import {"+name+"} from '../src/"+name+".js';test('aqe "+name+"',()=>assert.equal("+name+","+(name==='a'?1:2)+"));";if(mode==='identical')code="import test from 'node:test';test('same',()=>{});";if(mode==='wrong')code=code.replace('assert.equal('+name+','+(name==='a'?1:2)+')','assert.equal('+name+',999)');if(mode==='credential-code')code+='//'+process.env.OPENAI_API_KEY;if(mode==='weak')code="import test from 'node:test';test('TODO assertion',()=>{});";if(mode==='invalid')fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({tests:[{testFile:'../../escape.test.js',testCode:code}]}));else fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({tests:[{testFile:path.join(process.cwd(),file),testCode:code,llmEnhanced:false,qualityGateResult:{passed:true,score:100}}],coverageEstimate:100}));`;
 const root=fixture(t,{...twoModules,'tools/worker.mjs':worker,'tools/aqe.cjs':cli,'tddswarm.requirements.md':'Public a equals 1 and public b equals 2.','tddswarm.config.json':{agent:['node','tools/worker.mjs'],plugins:{'agentic-qe':{enabled,command,framework:'node',timeoutMs}}}});
 return root;
}
const payloads=root=>fs.readFileSync(path.join(root,'.tddswarm/worker-payloads.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const artifacts=root=>fs.readdirSync(path.join(root,'.tddswarm/candidates')).map(id=>path.join(root,'.tddswarm/candidates',id));

test('enabled AQE authors are merged and independently reviewed before normal isolated validation',async t=>{
 const root=setup(t,{tasks:['src/a.js','src/b.js']});const result=await generate(root,{execute:true,plugin:'agentic-qe'});
 assert.equal(result.generationProvider,'agentic-qe');assert.equal(result.calls,2);assert.equal(result.generation.authorCalls,2);assert.equal(result.status,'reviewed-candidates');assert.equal(result.applied,false);assert.equal(result.measured.execution,false);
 assert.deepEqual(result.files,['test/aqe-a.test.js','test/aqe-b.test.js']);assert.deepEqual(payloads(root).map(p=>p.role),['architect','reviewer']);const reviewed=payloads(root)[1];assert.equal(reviewed.requirements,'Public a equals 1 and public b equals 2.');assert.equal(reviewed.files.length,2);assert.equal(reviewed.upstream,undefined);assert.equal(reviewed.artifacts,undefined);
 for(const artifact of result.generation.artifacts){assert.equal(artifact.status,'unreviewed-candidates');assert.equal(artifact.measured.execution,false);assert.equal(artifact.upstream.coverageEstimate,100);assert.ok(artifact.fileHashes[artifact.files[0]]);assert.equal(fs.existsSync(path.join(root,artifact.files[0])),false);}
 const calls=fs.readFileSync(path.join(root,'.tddswarm/aqe-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.args.includes('generate')).length,2);assert.ok(calls.filter(c=>c.args.includes('generate')).every(c=>c.cwd!==root&&c.args.includes('--format')&&!c.args.includes('author')));
 const checked=validateCandidates(root,result.id);assert.equal(checked.accepted,true,JSON.stringify(checked.reasons));assert.equal(checked.candidate.tests.filter(t=>t.status==='passed').length,4);
});

test('disabled and nonexecuting AQE never probe or spawn its command',async t=>{
 const root=setup(t,{enabled:false,command:['missing-aqe-command']});const result=await generate(root,{execute:true});assert.equal(result.generationProvider,'json-worker');assert.deepEqual(payloads(root).map(p=>p.role),['architect','author','reviewer']);assert.equal(fs.existsSync(path.join(root,'.tddswarm/aqe-calls.jsonl')),false);
 await assert.rejects(generate(root,{execute:true,plugin:'agentic-qe'}),/Enable/);
 const enabled=setup(t);const order=await generate(enabled);assert.equal(order.executed,false);assert.equal(order.generationProvider,'agentic-qe');assert.equal(fs.existsSync(path.join(enabled,'.tddswarm')),false);
});

test('an enabled author provider cannot replace missing architect/reviewer or missing independent requirements',async t=>{
 const root=setup(t);const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));delete config.agent;write(root,'tddswarm.config.json',config);assert.equal((await generate(root)).executed,false);await assert.rejects(generate(root,{execute:true}),/Configure an agent/);assert.equal(fs.existsSync(path.join(root,'.tddswarm/aqe-calls.jsonl')),false);
 const noRequirements=setup(t);fs.unlinkSync(path.join(noRequirements,'tddswarm.requirements.md'));await assert.rejects(generate(noRequirements,{execute:true}),/requirements/);assert.equal(fs.existsSync(path.join(noRequirements,'.tddswarm/aqe-calls.jsonl')),false);
});

test('missing or partly failing AQE retains evidence and never silently falls back to JSON authors',async t=>{
 const missing=setup(t,{command:['missing-testlore-aqe']});await assert.rejects(generate(missing,{execute:true}),/AQE generation failed/);assert.deepEqual(payloads(missing).map(p=>p.role),['architect']);const absent=JSON.parse(fs.readFileSync(path.join(artifacts(missing)[0],'aqe-review.json')));assert.equal(absent.complete,false);assert.equal(absent.applied,false);
 const partial=setup(t,{tasks:['src/a.js','src/b.js'],mode:'fail-second'});await assert.rejects(generate(partial,{execute:true}),/AQE generation failed/);assert.deepEqual(payloads(partial).map(p=>p.role),['architect']);assert.equal(artifacts(partial).length,2);assert.ok(artifacts(partial).every(dir=>!fs.existsSync(path.join(dir,'manifest.json'))));assert.equal(fs.existsSync(path.join(partial,'test/aqe-a.test.js')),false);
});

test('AQE upstream score 100 does not override independent reviewer rejection',async t=>{
 const root=setup(t,{mode:'weak',reviewResult:{accepted:false,findings:['Missing assertions and independent behavior oracle.']}});const result=await generate(root,{execute:true});assert.equal(result.status,'rejected-candidates');assert.equal(result.generation.artifacts[0].upstream.qualityGates[0].score,100);assert.equal(result.measured.execution,false);const checked=validateCandidates(root,result.id);assert.equal(checked.accepted,false);assert.ok(checked.reasons.includes('independent-review-rejected'));
});

test('AQE duplicate files deduplicate only identical code and reject conflicting outputs',async t=>{
 const same=setup(t,{tasks:['src/a.js','src/b.js'],mode:'identical'});assert.deepEqual((await generate(same,{execute:true})).files,['test/shared.test.js']);
 const conflict=setup(t,{tasks:['src/a.js','src/b.js'],mode:'conflict'});await assert.rejects(generate(conflict,{execute:true}),/Conflicting AQE candidate path/);assert.deepEqual(payloads(conflict).map(p=>p.role),['architect']);
});

test('source drift and unsafe AQE artifacts cannot reach independent review or staging',async t=>{
 const drift=setup(t,{mode:'drift'});await assert.rejects(generate(drift,{execute:true}),/provenance changed/);assert.deepEqual(payloads(drift).map(p=>p.role),['architect']);assert.ok(artifacts(drift).every(dir=>!fs.existsSync(path.join(dir,'manifest.json'))));
 const invalid=setup(t,{mode:'invalid'});await assert.rejects(generate(invalid,{execute:true}),/invalid candidate/);assert.deepEqual(payloads(invalid).map(p=>p.role),['architect']);
 const testSubject=setup(t,{tasks:['test/a.test.js']});await assert.rejects(generate(testSubject,{execute:true}),/Invalid architect task/);assert.equal(fs.existsSync(path.join(testSubject,'.tddswarm/aqe-calls.jsonl')),false);
});

test('AQE argv resolution binds executable and Node script while preserving ordinary arguments',t=>{
 const root=setup(t);const argv=aqeCommand(root,['node','tools/aqe.cjs','src/a.js','--ordinary','tools/worker.mjs']);assert.ok(path.isAbsolute(argv[0]));assert.equal(argv[1],fs.realpathSync(path.join(root,'tools/aqe.cjs')));assert.deepEqual(argv.slice(2),['src/a.js','--ordinary','tools/worker.mjs']);
 const executable=path.join(root,'node_modules/.bin/aqe');fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n');fs.chmodSync(executable,0o755);assert.equal(aqeCommand(root)[0],fs.realpathSync(executable));
 assert.deepEqual(aqeCommand(root,['node','-e','console.log("tools/aqe.cjs")']).slice(1),['-e','console.log("tools/aqe.cjs")']);
});


test('a project-relative AQE executable runs from the disposable workspace',t=>{
 const root=setup(t),script=path.join(root,'tools/aqe.cjs');fs.writeFileSync(script,'#!/usr/bin/env node\n'+fs.readFileSync(script,'utf8'));fs.chmodSync(script,0o755);
 const report=aqeGenerate(root,{command:['./tools/aqe.cjs'],target:'src/a.js',framework:'node'});assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.applied,false);assert.ok(report.fileHashes['test/aqe-a.test.js']);
});


test('upstream score 100 and an accepting reviewer still require passing execution evidence',async t=>{
 const root=setup(t,{mode:'wrong'}),result=await generate(root,{execute:true});assert.equal(result.status,'reviewed-candidates');assert.equal(result.generation.artifacts[0].upstream.qualityGates[0].score,100);
 const checked=validateCandidates(root,result.id);assert.equal(checked.accepted,false);assert.ok(checked.reasons.includes('candidate-suite-failed-empty-or-incomplete'));assert.equal(fs.existsSync(path.join(root,'test/aqe-a.test.js')),false);
});

test('AQE generation timeouts kill a producer that ignores SIGTERM and retain its failed receipt',async t=>{
 const root=setup(t,{mode:'hung',timeoutMs:100}),started=Date.now();await assert.rejects(generate(root,{execute:true}),/AQE generation failed/);assert.ok(Date.now()-started<5000);const receipt=JSON.parse(fs.readFileSync(path.join(artifacts(root)[0],'aqe-review.json')));assert.equal(receipt.complete,false);assert.match(receipt.error,/ETIMEDOUT/);
});


test('AQE provider credentials require an explicit name allowlist and are never copied into receipts',async t=>{
 const previous={OPENAI_API_KEY:process.env.OPENAI_API_KEY,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,GEMINI_API_KEY:process.env.GEMINI_API_KEY};process.env.OPENAI_API_KEY='controlled-openai-key';process.env.ANTHROPIC_API_KEY='controlled-anthropic-key';
 t.after(()=>{for(const [name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
 const root=setup(t),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));config.plugins['agentic-qe'].envNames=['OPENAI_API_KEY'];write(root,'tddswarm.config.json',config);const result=await generate(root,{execute:true});
 const call=fs.readFileSync(path.join(root,'.tddswarm/aqe-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).find(call=>call.args.includes('generate'));assert.equal(call.openaiPresent,true);assert.equal(call.anthropicPresent,false);assert.ok(!JSON.stringify(result).includes('controlled-openai-key'));assert.ok(!JSON.stringify(result).includes('controlled-anthropic-key'));
 const disabledKeys=setup(t);await generate(disabledKeys,{execute:true});const defaultCall=fs.readFileSync(path.join(disabledKeys,'.tddswarm/aqe-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).find(call=>call.args.includes('generate'));assert.equal(defaultCall.openaiPresent,false);assert.equal(defaultCall.anthropicPresent,false);
 const missing=setup(t),missingConfig=JSON.parse(fs.readFileSync(path.join(missing,'tddswarm.config.json')));missingConfig.plugins['agentic-qe'].envNames=['GEMINI_API_KEY'];delete process.env.GEMINI_API_KEY;write(missing,'tddswarm.config.json',missingConfig);await assert.rejects(generate(missing,{execute:true}),/provider variable is unavailable: GEMINI_API_KEY/);assert.equal(fs.existsSync(path.join(missing,'.tddswarm/aqe-calls.jsonl')),false);
});

test('AQE composition accepts a runtime review worker and disabled AQE preserves existing-test author tasks',async t=>{
 const root=setup(t),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));delete config.agent;write(root,'tddswarm.config.json',config);
 const plugin=await generate(root,{execute:true,agent:['node','tools/worker.mjs']});assert.equal(plugin.generationProvider,'agentic-qe');assert.deepEqual(payloads(root).map(p=>p.role),['architect','reviewer']);
 const disabled=setup(t,{enabled:false,tasks:['test/a.test.js']});const legacy=await generate(disabled,{execute:true});assert.equal(legacy.generationProvider,'json-worker');assert.deepEqual(payloads(disabled).map(p=>p.role),['architect','author','reviewer']);
});

function automatic(t,{mode='normal',tasks=['src/a.js','src/b.js']}={}){
 const root=setup(t,{mode,tasks});
 const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'),'utf8'));
 delete config.plugins;config.adapter='vitest';write(root,'tddswarm.config.json',config);
 const script=fs.readFileSync(path.join(root,'tools/aqe.cjs'),'utf8').replace("path.resolve(__dirname,'..')",JSON.stringify(root));
 write(root,'node_modules/agentic-qe/package.json',{name:'agentic-qe',version:'3.14.8',bin:{aqe:'./dist/cli.cjs'}});
 write(root,'node_modules/agentic-qe/dist/cli.cjs',script);
 if(tasks.includes('src/c.js'))write(root,'src/c.js','export const c=2;');
 return root;
}
test('bounded AQE subprocess authors actually overlap while a third task waits for the settled batch',async t=>{
 const root=automatic(t,{mode:'overlap',tasks:['src/a.js','src/b.js','src/c.js']});const result=await generate(root,{execute:true});
 assert.equal(result.generationPlan.mode,'auto');assert.equal(result.generationProvider,'agentic-qe');assert.equal(result.generation.artifacts.length,3);assert.equal(result.generation.fallbacks.length,0);
 const events=fs.readFileSync(path.join(root,'.tddswarm/aqe-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const by=Object.fromEntries(['a','b','c'].map(name=>[name,events.filter(e=>e.target==='src/'+name+'.js')]));
 assert.ok(Math.max(by.a[0].at,by.b[0].at)<Math.min(by.a[1].at,by.b[1].at),JSON.stringify(events));
 assert.ok(by.c[0].at>=Math.max(by.a[1].at,by.b[1].at),JSON.stringify(events));
 assert.deepEqual(result.generation.cost,{tokens:null,currency:null});assert.deepEqual(payloads(root).map(p=>p.role),['architect','reviewer']);
});
test('automatic failure retains its receipt and falls back only for the failed task after the batch settles',async t=>{
 const root=automatic(t,{mode:'fallback-overlap'}),result=await generate(root,{execute:true});
 assert.equal(result.generation.fallbacks.length,1);assert.equal(result.generation.fallbacks[0].subject,'src/b.js');assert.match(result.generation.fallbacks[0].reason,/AQE exited 7/);
 assert.deepEqual(payloads(root).map(p=>p.role),['architect','author','reviewer']);assert.equal(payloads(root)[1].task.subject,'src/b.js');const ends=fs.readFileSync(path.join(root,'.tddswarm/aqe-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.event==='end');assert.ok(payloads(root)[1].observedAt>=Math.max(...ends.map(e=>e.at)));assert.ok(result.generation.artifacts.some(a=>!a.complete&&a.exitCode===7));assert.ok(result.files.includes('test/aqe-a.test.js'));assert.ok(!result.files.includes('test/aqe-b.test.js'));assert.deepEqual(result.generation.fallbacks[0].cost,{tokens:null,currency:null});
});
test('automatic source drift rejects the complete settled batch without invoking fallback or reviewer',async t=>{
 const root=automatic(t,{mode:'drift'});await assert.rejects(generate(root,{execute:true}),/provenance changed/);assert.deepEqual(payloads(root).map(p=>p.role),['architect']);assert.ok(artifacts(root).every(dir=>!fs.existsSync(path.join(dir,'manifest.json'))));
});
test('explicit provider JSON overrides enabled AQE without probing and total run budget is bounded',async t=>{
 const root=setup(t);const result=await generate(root,{execute:true,provider:'json-worker'});assert.equal(result.generationProvider,'json-worker');assert.equal(fs.existsSync(path.join(root,'.tddswarm/aqe-calls.jsonl')),false);
 await assert.rejects(generate(setup(t),{execute:true,totalTimeoutMs:900001}),/totalTimeoutMs/);
 await assert.rejects(generate(setup(t),{execute:true,totalTimeoutMs:1}),/timed out|budget exhausted/);
});
test('explicit provider secrets printed by upstream are redacted before retained failure receipts',async t=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-key-that-must-never-persist';t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;});
 const root=setup(t,{mode:'leak'}),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));config.plugins['agentic-qe'].envNames=['OPENAI_API_KEY'];write(root,'tddswarm.config.json',config);
 await assert.rejects(generate(root,{execute:true}),error=>!error.message.includes('fixture-key-that-must-never-persist'));
 const receipt=fs.readFileSync(path.join(artifacts(root)[0],'aqe-review.json'),'utf8');assert.ok(!receipt.includes('fixture-key-that-must-never-persist'));assert.match(receipt,/REDACTED/);
});

test('a failing automatic JSON fallback retains the plan, original AQE failure and bounded attempt accounting',async t=>{
 const root=automatic(t,{mode:'fail-second'});
 // Supply a dedicated valid protocol worker whose author phase genuinely fails.
 write(root,'tools/worker.mjs',`let input='';for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input);if(p.role==='author'){console.error('fallback rejected');process.exit(8);}process.stdout.write(JSON.stringify(p.role==='architect'?{tasks:[{subject:'src/a.js',instructions:'Check independent constant a.'},{subject:'src/b.js',instructions:'Check independent constant b.'}]}:${JSON.stringify(review)}));`);
 await assert.rejects(generate(root,{execute:true}),error=>{assert.equal(error.generation.status,'generation-failed');assert.equal(error.generation.aqeAuthorAttempts,2);assert.equal(error.generation.jsonAuthorCalls,1);assert.equal(error.generation.fallbacks[0].status,'failed');assert.equal(error.generation.artifacts.filter(a=>!a.complete).length,1);const retained=JSON.parse(fs.readFileSync(error.generation.receipt,'utf8'));assert.equal(retained.fallbacks[0].subject,'src/b.js');assert.match(retained.error,/fallback rejected/);return true;});
});

test('provider binding drift is rejected without fallback or review',async t=>{
 const root=automatic(t,{mode:'binding-drift'});await assert.rejects(generate(root,{execute:true}),error=>{assert.match(error.message,/provider binding changed/);assert.equal(error.generation.fallbacks.length,0);assert.equal(error.generation.status,'generation-failed');return true;});assert.deepEqual(payloads(root).map(p=>p.role),['architect']);
});

test('AQE credential-bearing candidate code is rejected before any candidate content is persisted',async t=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='candidate-credential-fixture';t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;});
 const root=setup(t,{mode:'credential-code'}),config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json')));config.plugins['agentic-qe'].envNames=['OPENAI_API_KEY'];write(root,'tddswarm.config.json',config);
 await assert.rejects(generate(root,{execute:true}),/provider credential in candidate code/);
 for(const file of fs.readdirSync(path.join(root,'.tddswarm'),{recursive:true})){const absolute=path.join(root,'.tddswarm',file);if(fs.statSync(absolute).isFile())assert.ok(!fs.readFileSync(absolute,'utf8').includes('candidate-credential-fixture'),file);}
});
test('successful and timed-out JSON transports terminate their ordinary descendant process group',async t=>{
 if(process.platform==='win32'){t.skip('POSIX process group contract');return;}
 for(const hung of [false,true]){
  const root=fixture(t,{'worker.mjs':`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',"setTimeout(()=>require('fs').writeFileSync('orphan.txt','late write'),500)"],{stdio:'ignore'});child.unref();${hung?"setInterval(()=>{},1000);":"process.stdout.write('{}');"}`});
  if(hung)await assert.rejects(callAgent([process.execPath,'worker.mjs'],{},root,100),/timed out/);else await callAgent([process.execPath,'worker.mjs'],{},root,1000);
  await new Promise(resolve=>setTimeout(resolve,650));assert.equal(fs.existsSync(path.join(root,'orphan.txt')),false);
 }
});

test('failed architect and reviewer retain accurate attempts and declarative total routing budgets',async t=>{
 const architect=setup(t);write(architect,'tools/worker.mjs',"console.error('architect unavailable');process.exit(9);");
 await assert.rejects(generate(architect,{execute:true,totalTimeoutMs:25000,maxOutputBytes:65536}),error=>{const report=error.generation;assert.equal(report.architectAttempts,1);assert.equal(report.reviewerAttempts,0);assert.equal(report.aqeAuthorAttempts,0);assert.equal(report.jsonAuthorCalls,0);assert.equal(report.workerCalls,1);assert.equal(report.plan.budget.totalTimeoutMs,25000);assert.equal(report.plan.budget.maxTasks,12);assert.equal(report.plan.budget.maxWorkerCalls,14);assert.equal(report.plan.budget.maxOutputBytes,65536);assert.ok(report.plan.budget.deadlineAt>Date.now());assert.equal(JSON.parse(fs.readFileSync(report.receipt,'utf8')).workerCalls,1);return true;});
 const root=automatic(t,{tasks:['src/a.js']});write(root,'tools/worker.mjs',`let input='';for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input);if(p.role==='reviewer'){console.error('reviewer unavailable');process.exit(11);}process.stdout.write(JSON.stringify({tasks:[{subject:'src/a.js',instructions:'Check independent constant a.'}]}));`);
 await assert.rejects(generate(root,{execute:true,totalTimeoutMs:25000}),error=>{const report=error.generation;assert.match(error.message,/reviewer unavailable/);assert.equal(report.architectAttempts,1);assert.equal(report.reviewerAttempts,1);assert.equal(report.aqeAuthorAttempts,1);assert.equal(report.jsonAuthorCalls,0);assert.equal(report.workerCalls,3);assert.equal(report.plan.budget.maxWorkerCalls,26);assert.equal(report.plan.budget.totalTimeoutMs,25000);assert.equal(report.plan.budget.maxAqeAuthorTimeoutMs,120000);assert.equal(report.plan.maxParallelAuthors,2);assert.deepEqual(report.cost,{tokens:null,currency:null});assert.equal(JSON.parse(fs.readFileSync(report.receipt,'utf8')).reviewerAttempts,1);return true;});
});

test('invalid architect tasks retain a failure receipt with one attempted worker and zero author/reviewer calls',async t=>{
 const root=setup(t,{tasks:['../escape.js']});await assert.rejects(generate(root,{execute:true}),error=>{assert.match(error.message,/Invalid architect task/);const retained=JSON.parse(fs.readFileSync(error.generation.receipt,'utf8'));assert.equal(retained.status,'generation-failed');assert.equal(retained.architectAttempts,1);assert.equal(retained.reviewerAttempts,0);assert.equal(retained.workerCalls,1);assert.equal(retained.jsonAuthorCalls,0);assert.equal(retained.aqeAuthorAttempts,0);assert.equal(retained.plan.budget.maxTasks,12);return true;});
});
