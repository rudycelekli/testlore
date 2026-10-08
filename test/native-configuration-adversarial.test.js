import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {normalizeNativeProjects} from '../src/native-project-contracts.js';

const {analyze,configurationFlags}=createRequire(import.meta.url)('../src/source-analysis.cjs');
const flags=source=>configurationFlags(analyze('vitest.config.ts',source).ast);

test('only literal flag-prefix Boolean queries receive comparable argv observations',()=>{
 const result=flags(`const a=process.argv.some(arg=>arg.startsWith('--coverage')); const b=process.argv.some(v=>v.startsWith('--shard='));`);
 assert.equal(result.argvDependent,false);
 assert.deepEqual(result.argvPrefixChecks,['--coverage','--shard=']);
});

for(const [name,source] of Object.entries({
 indexed:`const q=process.argv[2];`,
 includes:`const q=process.argv.includes('run');`,
 computedReceiver:`const q=process['argv'].some(a=>a.startsWith('--coverage'));`,
 computedMethod:`const q=process.argv['some'](a=>a.startsWith('--coverage'));`,
 optionalReceiver:`const q=process?.argv.some(a=>a.startsWith('--coverage'));`,
 optionalCall:`const q=process.argv.some?.(a=>a.startsWith('--coverage'));`,
 aliased:`const a=process.argv; const q=a.some(v=>v.startsWith('--coverage'));`,
 destructured:`const {argv}=process; const q=argv.some(v=>v.startsWith('--coverage'));`,
 callbackSideEffect:`const q=process.argv.some(v=>{ console.log(v); return v.startsWith('--coverage'); });`,
 namedCallback:`const predicate=v=>v.startsWith('--coverage'); const q=process.argv.some(predicate);`,
 dynamicPrefix:`const q=process.argv.some(v=>v.startsWith(prefix));`,
 startsWithOffset:`const q=process.argv.some(v=>v.startsWith('--coverage',1));`,
 extraSomeArgument:`const q=process.argv.some(v=>v.startsWith('--coverage'),{});`,
 localProcess:`const process={argv:['--coverage']};const q=process.argv.some(v=>v.startsWith('--coverage'));`,
 changedProcess:`process.argv=[];const q=process.argv.some(v=>v.startsWith('--coverage'));`,
 execArgv:`const q=process.execArgv.some(v=>v.startsWith('--coverage'));`,
 mixedOpaqueRead:`const q=process.argv.some(v=>v.startsWith('--coverage'));const argv=otherInput;`,
 nonFlagPrefix:`const q=process.argv.some(v=>v.startsWith('list'));`,
 emptyPrefix:`const q=process.argv.some(v=>v.startsWith(''));`
}))test(`configuration admission retains rejection for ${name}`,()=>assert.equal(flags(source).argvDependent,true));

test('prefix observations cannot conceal modified intrinsic semantics',()=>{
 for(const mutation of [
  `Array.prototype.some=function(){return this[2]==='list';};`,
  `String.prototype.startsWith=function(){return true;};`,
  `Object.defineProperty(Array.prototype,'some',{value:()=>true});`,
  `Reflect.defineProperty(String.prototype,'startsWith',{value:()=>true});`
 ]){
  const result=flags(mutation+`const q=process.argv.some(v=>v.startsWith('--coverage'));`);
  assert.equal(result.argvIntrinsicMutation,true);
  assert.deepEqual(result.argvPrefixChecks,['--coverage']);
 }
});

const root='/bounded/repository';
function local(base,file){const value=path.relative(base,file);if(!value||value.startsWith('../')||path.isAbsolute(value))throw new Error('External project file');return value;}
const contract=(extra={})=>({name:'project',isolate:true,files:['checks/a.test.js'],setupFiles:[],...extra});
const normalize=projects=>normalizeNativeProjects(root,projects,['checks/a.test.js','checks/b.test.js'],local);

test('project inventory cannot authorize missing, overlapping or out-of-scope memberships',()=>{
 assert.throws(()=>normalize([contract()]),/Incomplete/);
 assert.throws(()=>normalize([contract(),contract({name:'other',files:['checks/a.test.js','checks/b.test.js']})]),/Overlapping/);
 assert.throws(()=>normalize([contract({files:['checks/a.test.js','checks/a.test.js','checks/b.test.js']})]),/Overlapping/);
 assert.throws(()=>normalize([contract({files:['checks/a.test.js','checks/b.test.js','checks/c.test.js']})]),/unknown/);
 assert.throws(()=>normalize([contract({files:['../external.test.js']})]),/External/);
 assert.throws(()=>normalize([contract({files:['checks/a.test.js']}),contract({files:['checks/b.test.js']})]),/Invalid/);
});

test('project inventory preserves isolation metadata and rejects unbounded/malformed contracts',()=>{
 const result=normalize([contract({isolate:false,files:['checks/b.test.js','checks/a.test.js'],setupFiles:['setup.js','setup.js']})]);
 assert.deepEqual(result,[{name:'project',isolate:false,files:['checks/a.test.js','checks/b.test.js'],setupFiles:['setup.js']}]);
 assert.throws(()=>normalize(Array(129).fill(contract())),/Unbounded/);
 for(const extra of [{isolate:'false'},{files:Array(10001).fill('checks/a.test.js')},{setupFiles:Array(1001).fill('setup.js')},{name:'x'.repeat(201)},{setupFiles:[{}]}])assert.throws(()=>normalize([contract(extra)]));
});
