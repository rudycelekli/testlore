import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generate} from '../src/swarm.js';
import {aqeCommand,aqeGenerate} from '../src/adapters/aqe.js';
import {validateCandidates} from '../src/candidates.js';
import {fixture,write,twoModules} from './helpers.js';
const review={accepted:true,findings:['Protocol fixture review, no model invoked.'],oracle:{independent:true,basis:['Written contract: a equals 1 and b equals 2.']}};
function setup(t,{enabled=true,tasks=['src/a.js'],mode='normal',reviewResult=review,command=['node','tools/aqe.cjs'],timeoutMs=5000}={}) {
 const worker=`import fs from 'node:fs';let input='';for await(const part of process.stdin)input+=part;const p=JSON.parse(input);fs.mkdirSync('.tddswarm',{recursive:true});fs.appendFileSync('.tddswarm/worker-payloads.jsonl',JSON.stringify(p)+'\\n');const result=p.role==='architect'?{tasks:${JSON.stringify(tasks.map(subject=>({subject,instructions:'Check written constant contract.'})))}}:p.role==='author'?{files:[{path:'test/worker.test.js',content:"import test from 'node:test';test('worker',()=>{});"}]}:${JSON.stringify(reviewResult)};process.stdout.write(JSON.stringify(result));`;
 const cli=`const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),a=process.argv.slice(2);fs.mkdirSync(path.join(root,'.tddswarm'),{recursive:true});fs.appendFileSync(path.join(root,'.tddswarm/aqe-calls.jsonl'),JSON.stringify({args:a,cwd:process.cwd(),openaiPresent:Boolean(process.env.OPENAI_API_KEY),anthropicPresent:Boolean(process.env.ANTHROPIC_API_KEY)})+'\\n');if(a.includes('--help')){console.log('generate --framework --format --output');process.exit(0);}const target=a[a.indexOf('generate')+1],name=path.basename(target,'.js'),mode=${JSON.stringify(mode)};if(mode==='hung'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);return;}if(mode==='fail-second'&&name==='b')process.exit(7);if(mode==='drift')fs.writeFileSync(path.join(root,'src/a.js'),'export const a=999;');const file=mode==='identical'||mode==='conflict'?'test/shared.test.js':'test/aqe-'+name+'.test.js';let code="import test from 'node:test';import assert from 'node:assert/strict';import {"+name+"} from '../src/"+name+".js';test('aqe "+name+"',()=>assert.equal("+name+","+(name==='a'?1:2)+"));";if(mode==='identical')code="import test from 'node:test';test('same',()=>{});";if(mode==='wrong')code=code.replace('assert.equal('+name+','+(name==='a'?1:2)+')','assert.equal('+name+',999)');if(mode==='weak')code="import test from 'node:test';test('TODO assertion',()=>{});";if(mode==='invalid')fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({tests:[{testFile:'../../escape.test.js',testCode:code}]}));else fs.writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({tests:[{testFile:path.join(process.cwd(),file),testCode:code,llmEnhanced:false,qualityGateResult:{passed:true,score:100}}],coverageEstimate:100}));`;
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
