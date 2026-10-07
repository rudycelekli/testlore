import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizePlanningProof} from '../scripts/normalize-planning-proof.js';
import {fixture,write} from './helpers.js';
test('public planning copy replaces paths while binding original measurements and failures',t=>{
  const root=fixture(t),raw={complete:false,sourceHash:'abc',trials:[{elapsedMs:8.125,workerComplete:false,config:{runner:['/Users/sample/node','/Users/sample/repo/node_modules/vitest/vitest.mjs']},normalized:{tests:[{id:'fault-id',status:'failed'}]}}],failure:{message:'No space'}};
  write(root,'raw.json',raw);write(root,'raw.jsonl',JSON.stringify({event:'worker-completed',attempt:raw.trials[0]})+'\n');
  const receipt=path.join(root,'raw.json'),journal=path.join(root,'raw.jsonl'),before=fs.readFileSync(receipt);
  const binding=normalizePlanningProof({receipt,journal,nodeExecutable:'/Users/sample/node',repository:'/Users/sample/repo',outputReceipt:path.join(root,'public.json'),outputJournal:path.join(root,'public.jsonl')});
  assert.equal(binding.rawReceiptSha256,createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(fs.readFileSync(receipt),before);
  const result=JSON.parse(fs.readFileSync(path.join(root,'public.json')));assert.equal(result.complete,false);
  assert.equal(result.trials[0].elapsedMs,8.125);assert.deepEqual(result.trials[0].normalized,raw.trials[0].normalized);
  assert.equal(result.trials[0].workerComplete,false);assert.equal(result.failure.message,'No space');
  assert.deepEqual(result.trials[0].config.runner,['<node-executable>','<candidate-repository>/node_modules/vitest/vitest.mjs']);
  const lines=fs.readFileSync(path.join(root,'public.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(lines[0].rawJournalSha256,binding.rawJournalSha256);assert.equal(lines[1].attempt.elapsedMs,8.125);
  assert.equal(fs.readFileSync(path.join(root,'public.json'),'utf8').includes('/Users/'),false);
});
test('normalizer rejects unknown personal paths before creating a public copy',t=>{
  const root=fixture(t,{'raw.json':JSON.stringify({path:'/Users/other/private'}),'raw.jsonl':'{}\n'});
  const output=path.join(root,'public.json');
  assert.throws(()=>normalizePlanningProof({receipt:path.join(root,'raw.json'),journal:path.join(root,'raw.jsonl'),nodeExecutable:'/Users/sample/node',repository:'/Users/sample/repo',outputReceipt:output,outputJournal:output+'l'}),/Unmapped personal/);
  assert.equal(fs.existsSync(output),false);
});
