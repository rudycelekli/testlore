import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {proposeRegistrationContracts,validateRegistrationContracts} from '../src/registration-contracts.js';
import {buildGraph} from '../src/graph.js';
import {plan} from '../src/selector.js';
import {fixture} from './helpers.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const source=`export const registry={register(value){globalThis.sharedSetting=value}};registry.register('regressed');`;
const consumer=`import assert from 'node:assert/strict';assert.equal(globalThis.sharedSetting,'healthy');`;

test('a domain registration can break a consumer outside its import closure, which must remain selected',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'src/registry.js':source,'test/registration.test.js':`import '../src/registry.js';`,'test/global-consumer.test.js':consumer});
 const graph=buildGraph(root),proposals=proposeRegistrationContracts(graph);
 assert.deepEqual(proposals.proposals[0].knownConsumers,['test/registration.test.js']);
 assert.equal(proposals.proposals[0].omissionAuthority,false);
 assert.equal(proposals.proposals[0].sourceSha256,digest(source));
 assert.deepEqual(plan(root,{changed:['src/registry.js']}).selected,['test/global-consumer.test.js','test/registration.test.js']);
 assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',`await import('./src/registry.js');await import('./test/global-consumer.test.js');`],{cwd:root,stdio:'pipe'}),error=>error.status===1&&error.stderr.toString().includes('ERR_ASSERTION'));
});

const record=()=>({id:'ledger',calls:[{file:'src/registry.js',sourceSha256:digest(source)}],stateOwners:[{file:'src/registry.js',sourceSha256:digest(source)}],consumers:['test/global-consumer.test.js'],consumerSourceHashes:{'test/global-consumer.test.js':digest(consumer)},review:{status:'approved',rationale:'State owners and readers inspected; executable independent challenges still required.'},closedWorld:false});
test('even an approved review with all source bindings grants no omission authority',()=>{
 const result=validateRegistrationContracts([record()]);assert.equal(result.omissionAuthority,false);assert.equal(result.requiresIndependentQualification,true);
});
test('unbounded, unknown, wildcard, stale-shaped and closed-world assertions are rejected',()=>{
 for(const mutate of [value=>value.closedWorld=true,value=>value.calls[0].file='../registry.js',value=>value.calls[0].file='src/*.js',value=>value.calls[0].sourceSha256='0',value=>value.calls[0].sourceSha256=[digest(source)],value=>value.calls.push(value.calls[0]),value=>value.review.rationale='',value=>value.review.proof=true,value=>value.consumerSourceHashes={},value=>value.consumers.push('test/missing.test.js'),value=>value.omissionAuthority=true]){
  const value=record();mutate(value);assert.throws(()=>validateRegistrationContracts([value]));
 }
 assert.throws(()=>validateRegistrationContracts([record(),record()]));
 assert.throws(()=>validateRegistrationContracts(Array(33).fill(record())));
});
test('proposals bind current bytes and never infer missing source or hidden readers',()=>{
 const graph={sources:{'src/registry.js':source},warnings:[{file:'src/registry.js',reason:'runtime-registration'},{file:'src/missing.js',reason:'runtime-registration'}],tests:['test/global-consumer.test.js'],edges:{}};
 const first=proposeRegistrationContracts(graph);assert.equal(first.proposals.find(value=>value.file==='src/missing.js').status,'source-unavailable');assert.deepEqual(first.proposals.find(value=>value.file==='src/registry.js').knownConsumers,[]);
 graph.sources['src/registry.js']+='\n// fresh bytes';assert.notEqual(proposeRegistrationContracts(graph).proposals.find(value=>value.file==='src/registry.js').sourceSha256,first.proposals.find(value=>value.file==='src/registry.js').sourceSha256);
});
