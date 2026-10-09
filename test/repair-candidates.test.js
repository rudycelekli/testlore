import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,commit} from './helpers.js';
import {stageRepair,validateRepair,applyRepair,isRepairSourcePath,captureRepairState} from '../src/repair-candidates.js';
import {digest} from '../src/provenance.js';

const requirements='Addition returns the arithmetic sum; existing public checks remain unchanged.\n';
const review={accepted:true,findings:[],oracle:{independent:true,basis:['Maintainer requirements and original arithmetic assertions']}};
function project(t, extra={}) {
  const root=fixture(t,{
    'package.json':{type:'module'},'.gitignore':'.tddswarm/\n','tddswarm.config.json':{runner:[process.execPath,'--test','{files}']},
    'tddswarm.requirements.md':requirements,'src/add.js':'export const add=(a,b)=>a-b;\n',
    'test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/add.js';test('arithmetic sum',()=>assert.equal(add(2,3),5));test('zero identity',()=>assert.equal(add(2,0),2));\n",
    ...extra});commit(root);return root;
}
const stage=(root,content='export const add=(a,b)=>a+b;\n')=>stageRepair(root,{files:[{path:'src/add.js',content}],sourcePaths:['src/add.js'],requirements,review});
const validate=(root,item,options={})=>validateRepair(root,item.candidatePath,{timeoutMs:3000,totalTimeoutMs:30000,...options});

test('repair requires repeated independent assertion failures and full passing candidates before source apply',t=>{
  const root=project(t),originalTest=fs.readFileSync(path.join(root,'test/add.test.js')),item=stage(root),result=validate(root,item);
  assert.equal(result.accepted,true,JSON.stringify(result.reasons));assert.equal(result.baseline.length,2);assert.equal(result.candidateRuns.length,2);assert.equal(result.assertionRuns.length,2);
  assert.equal(result.original.tests.find(item=>item.name==='arithmetic sum').status,'failed');assert.equal(result.candidate.exitCode,0);
  assert.equal(result.assertionRuns[0].assertions[0].code,'ERR_ASSERTION');
  assert.equal(fs.readFileSync(path.join(root,'src/add.js'),'utf8'),'export const add=(a,b)=>a-b;\n');
  assert.equal(applyRepair(root,item.candidatePath).applied,true);assert.equal(fs.readFileSync(path.join(root,'src/add.js'),'utf8'),'export const add=(a,b)=>a+b;\n');
  assert.deepEqual(fs.readFileSync(path.join(root,'test/add.test.js')),originalTest);assert.throws(()=>applyRepair(root,item.candidatePath),/stale/);
});

test('pure admission rejects oracles, helpers, configuration, traversal and unsupported root paths',()=>{
  for(const file of ['test/add.test.js','src/add.test.js','src/config.js','src/helpers/add.js','src/setup.js','lib/fixtures/a.js','app/mock.js','src/../test.js','src\\add.js','src/.hidden.js','../src/add.js','packages/a/src/add.js','README.md'])assert.equal(isRepairSourcePath(file),false,file);
  for(const file of ['src/add.js','lib/math.mjs','app/api/route.ts','index.js','index.cjs'])assert.equal(isRepairSourcePath(file),true,file);
});

test('staging cannot create files, edit requirements/tests, or escape explicit source ownership',t=>{
  const root=project(t);
  const args={sourcePaths:['src/add.js'],requirements,review};
  assert.throws(()=>stageRepair(root,{...args,files:[{path:'src/new.js',content:'export const a=1;'}]}),/Invalid repair file/);
  assert.throws(()=>stageRepair(root,{...args,files:[{path:'test/add.test.js',content:'// removed oracle'}]}),/Invalid repair file/);
  assert.throws(()=>stageRepair(root,{...args,requirements:'changed',files:[{path:'src/add.js',content:'export const add=()=>5'}]}),/requirements/);
});

test('wrong patch fails, no source mutation occurs and rejected evidence cannot be applied',t=>{
  const root=project(t),item=stage(root,'export const add=(a,b)=>0;\n'),result=validate(root,item);
  assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/candidate-suite-not-all-green/);assert.throws(()=>applyRepair(root,item.candidatePath),/Accepted intact/);
  assert.equal(fs.readFileSync(path.join(root,'src/add.js'),'utf8'),'export const add=(a,b)=>a-b;\n');
});

test('ordinary named exceptions are not assertion evidence',t=>{
  const root=project(t,{'test/add.test.js':"import test from 'node:test';test('failure',()=>{throw new Error('not an assertion')});"}),item=stage(root),result=validate(root,item);
  assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/failure-is-not-native-assertion/);assert.equal(result.baseline.length,1);assert.equal(result.original.tests[0].status,'failed');
});

test('changing or removing test cases through production behavior is rejected',t=>{
  const root=project(t,{
    'src/add.js':'export const active=true; export const add=(a,b)=>a-b;\n',
    'test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {active,add} from '../src/add.js';if(active)test('arithmetic sum',()=>assert.equal(add(2,3),5));test('zero identity',()=>assert.equal(add(2,0),2));"});
  const item=stage(root,'export const active=false;export const add=(a,b)=>a+b;\n'),result=validate(root,item);
  assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/original-case-inventory/);
});

test('ambiguous same-file names reject rather than accepting ordinal identities',t=>{
  const root=project(t,{'test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/add.js';test('same',()=>assert.equal(add(2,3),5));test('same',()=>assert.equal(add(2,0),2));"});
  const result=validate(root,stage(root));assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/ambiguous-native-case/);
});

test('freshness binds ignored files, requirements, source files and native inputs',t=>{
  const root=project(t),item=stage(root);write(root,'ignored-oracle.txt','new bytes');
  const result=validate(root,item);assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/stale/);
  fs.rmSync(path.join(root,'ignored-oracle.txt'));write(root,'tddswarm.requirements.md','oracle drift');assert.throws(()=>validate(root,item),/requirements changed/);
});

test('runtime source attempts to modify the original oracle fail closed',t=>{
  const root=project(t),item=stage(root,"import fs from 'node:fs';fs.writeFileSync(new URL('../test/add.test.js',import.meta.url),'// erased');export const add=(a,b)=>a+b;\n");
  const result=validate(root,item);assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/incomplete|mutated|inventory|scope|all-green/);
  assert.match(fs.readFileSync(path.join(root,'test/add.test.js'),'utf8'),/assert.equal/);
});

test('candidate and validation tampering cannot be applied',t=>{
  const root=project(t),item=stage(root),result=validate(root,item);assert.equal(result.accepted,true,result.reasons.join(','));
  const receipt=path.join(item.directory,'validation.json'),value=JSON.parse(fs.readFileSync(receipt,'utf8'));value.cost=1;fs.writeFileSync(receipt,JSON.stringify(value));assert.throws(()=>applyRepair(root,item.candidatePath),/Accepted intact/);
  delete value.integrity;value.integrity=digest(value);fs.writeFileSync(receipt,JSON.stringify(value));assert.throws(()=>applyRepair(root,item.candidatePath),/Accepted intact/);
  fs.writeFileSync(receipt,JSON.stringify(result));write(root,'src/add.js','export const add=()=>8;');assert.throws(()=>applyRepair(root,item.candidatePath),/stale/);
});

test('candidate cannot turn retained passing cases into skips',t=>{
  const root=project(t,{'src/add.js':'export const skip=false;export const add=(a,b)=>a-b;\n','test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {skip,add} from '../src/add.js';test('arithmetic sum',()=>assert.equal(add(2,3),5));test('zero identity',{skip},()=>assert.equal(add(2,0),2));"});
  const result=validate(root,stage(root,'export const skip=true;export const add=(a,b)=>a+b;\n'));assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/original-case-inventory-or-skip-status-changed/);
});

test('installed dependency drift rejects validation and apply without treating lockfiles as sufficient',t=>{
  const root=project(t,{'node_modules/local/index.js':'export const number=1;'}),item=stage(root);
  write(root,'node_modules/local/index.js','export const number=2;');const result=validate(root,item);assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/stale/);
});

test('source payload corruption rejects even after native validation',t=>{
  const root=project(t),item=stage(root),result=validate(root,item);assert.equal(result.accepted,true,result.reasons.join(','));
  fs.writeFileSync(path.join(item.directory,'files/src/add.js'),'export const add=()=>0;');assert.throws(()=>applyRepair(root,item.candidatePath),/content changed/);
});

test('empty native suites and bounded discovery timeouts are rejected',t=>{
  const root=project(t,{'test/add.test.js':'// empty oracle'});let result=validate(root,stage(root));assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/incomplete-native-case/);
  const other=project(t,{'test/add.test.js':"await new Promise(resolve=>setTimeout(resolve,2000));import test from 'node:test';import assert from 'node:assert/strict';test('fail',()=>assert.equal(1,2));"});
  result=validate(other,stage(other),{timeoutMs:50,totalTimeoutMs:200});assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/discovery-incomplete|time-budget/);
});

test('narrow native name filters cannot be certified as full-suite repair evidence',t=>{
  const root=project(t,{'tddswarm.config.json':{runner:[process.execPath,'--test','--test-name-pattern=arithmetic','{files}']}});
  const result=validate(root,stage(root));assert.equal(result.accepted,false);assert.match(result.reasons.join(','),/assertion-evidence-unsupported/);assert.equal(result.baseline.length,0);
});

test('ignored prototype-like filenames remain bound immutable inputs',t=>{
  const root=project(t);write(root,'__proto__','original bytes');const before=captureRepairState(root);assert.equal(Object.hasOwn(before.scope.files,'__proto__'),true);
  write(root,'__proto__','different bytes');assert.notEqual(captureRepairState(root).scope.fingerprint,before.scope.fingerprint);
});
