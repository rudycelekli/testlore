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
