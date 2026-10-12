import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './helpers.js';
import {prepareNativeSourceSummaries,nativeSourceSummaryReader} from '../src/native-source-summaries.js';

test('byte-validated summaries preserve import and lexical configuration admission', t=>{
 const root=fixture(t,{'src/a.js':`import value from './b.js';export const plugins=[];console.log(process.argv);`});
 const prepared=prepareNativeSourceSummaries(root,['src/a.js']);
 const reader=nativeSourceSummaryReader(root,prepared),bytes=fs.readFileSync(path.join(root,'src/a.js'));
 const result=reader.read('src/a.js',bytes);
 assert.deepEqual(result.imports,['./b.js']);assert.equal(result.argvDependent,true);assert.equal(result.projectPlugins,true);
 assert.equal(reader.stats.validatedHits,1);assert.equal(reader.stats.freshParses,0);
});

test('changed bytes freshly parse dependencies and admission flags instead of trusting observations',t=>{
 const root=fixture(t,{'src/a.js':`import './b.js';`}),prepared=prepareNativeSourceSummaries(root,['src/a.js']);
 const reader=nativeSourceSummaryReader(root,prepared);
 const result=reader.read('src/a.js',Buffer.from(`import './changed.js';console.log(process.execArgv);export const plugins=[];`));
 assert.deepEqual(result.imports,['./changed.js']);assert.equal(result.argvDependent,true);assert.equal(result.projectPlugins,true);
 assert.equal(reader.stats.mismatches,1);assert.equal(reader.stats.freshParses,1);assert.equal(reader.stats.validatedHits,0);
});

test('wrong identity, malformed record, and newly discovered input all use the canonical parser',t=>{
 const root=fixture(t,{'src/a.js':`import './b.js';`}),prepared=prepareNativeSourceSummaries(root,['src/a.js']);
 const bytes=Buffer.from(`import './b.js';`);
 const wrong=nativeSourceSummaryReader(root,{...prepared,identity:{...prepared.identity,parserSha256:'0'.repeat(64)}});
 assert.deepEqual(wrong.read('src/a.js',bytes).imports,['./b.js']);assert.equal(wrong.stats.identityMatched,false);assert.equal(wrong.stats.freshParses,1);
 const malformed=nativeSourceSummaryReader(root,{...prepared,records:{'src/a.js':{...prepared.records['src/a.js'],imports:[1]}}});
 assert.deepEqual(malformed.read('src/a.js',bytes).imports,['./b.js']);assert.equal(malformed.stats.freshParses,1);
 const missing=nativeSourceSummaryReader(root,prepared);
 assert.deepEqual(missing.read('src/new.js',Buffer.from(`import './other.js';`)).imports,['./other.js']);assert.equal(missing.stats.freshParses,1);
});

test('source and count budgets disable observations while retaining fresh fallback',t=>{
 const root=fixture(t,{'src/large.js':''}),file=path.join(root,'src/large.js');fs.truncateSync(file,8*1024*1024+1);
 const prepared=prepareNativeSourceSummaries(root,['src/large.js']);assert.deepEqual(prepared,{used:false,reason:'source-byte-budget'});
 const reader=nativeSourceSummaryReader(root,prepared);assert.deepEqual(reader.read('src/a.js',Buffer.from(`import './fresh.js';`)).imports,['./fresh.js']);assert.equal(reader.stats.freshParses,1);
 assert.equal(prepareNativeSourceSummaries(root,Array(10001).fill('src/a.js')).reason,'source-count-budget');
});

test('native summaries distinguish whole type declarations and retain inline side-effect imports',t=>{
 const text=`import type { A } from './types'; export type { B } from './other'; import { type C } from './side-effect'; import './value';`;
 const root=fixture(t,{'src/a.ts':text}),prepared=prepareNativeSourceSummaries(root,['src/a.ts']);
 const reader=nativeSourceSummaryReader(root,prepared),result=reader.read('src/a.ts',Buffer.from(text));
 assert.deepEqual(result.imports,['./types','./other','./side-effect','./value']);
 assert.deepEqual(result.runtimeImports,['./side-effect','./value']);
 assert.equal(reader.stats.validatedHits,1);
 const legacy=structuredClone(prepared);delete legacy.records['src/a.ts'].runtimeImports;
 const oldReader=nativeSourceSummaryReader(root,legacy),old=oldReader.read('src/a.ts',Buffer.from(text));
 assert.deepEqual(old.runtimeImports,old.imports);assert.equal(oldReader.stats.validatedHits,1);
});

test('invalid runtime summary subsets and changed sources freshly parse without trusting hints',t=>{
 const text=`import type { A } from './types'; import './value';`;
 const root=fixture(t,{'src/a.ts':text}),prepared=prepareNativeSourceSummaries(root,['src/a.ts']);
 for(const runtimeImports of [['./foreign'],['./value','./value'],[1],null]){
  const invalid=structuredClone(prepared);invalid.records['src/a.ts'].runtimeImports=runtimeImports;
  const reader=nativeSourceSummaryReader(root,invalid),result=reader.read('src/a.ts',Buffer.from(text));
  assert.deepEqual(result.runtimeImports,['./value']);assert.equal(reader.stats.freshParses,1);assert.equal(reader.stats.validatedHits,0);
 }
 const changed=nativeSourceSummaryReader(root,prepared),result=changed.read('src/a.ts',Buffer.from(`import { A } from './types'; import './value';`));
 assert.deepEqual(result.runtimeImports,['./types','./value']);assert.equal(changed.stats.freshParses,1);
});
