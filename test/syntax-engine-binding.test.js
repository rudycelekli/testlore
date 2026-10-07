import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.js';
const require=createRequire(import.meta.url),source=fileURLToPath(new URL('../src/',import.meta.url));
function isolated(t){
 const root=fixture(t,{'package.json':{type:'module'},'project/a.js':`import './original.js';`});
 fs.cpSync(source,path.join(root,'src'),{recursive:true});
 const pkg=path.join(root,'node_modules/typescript');fs.mkdirSync(path.join(pkg,'lib'),{recursive:true});
 fs.copyFileSync(require.resolve('typescript/package.json'),path.join(pkg,'package.json'));fs.copyFileSync(require.resolve('typescript'),path.join(pkg,'lib/typescript.js'));
 return root;
}
function exercise(root,code){
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {prepareNativeSourceSummaries,nativeSourceSummaryReader}=await import('./src/native-source-summaries.js');${code}`],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:128*1024});
 assert.equal(result.status,0,result.stderr);assert.equal(result.error,undefined);
}
for(const target of ['src/source-analysis.cjs','node_modules/typescript/lib/typescript.js'])test(`cached implementation drift rejects summary production without executing changed ${target}`,t=>{
 const root=isolated(t);exercise(root,`
 const before=prepareNativeSourceSummaries(process.cwd(),['project/a.js']);assert.equal(before.used,true);
 const engine=require('./src/syntax-engine.cjs'),parser=require('./src/source-analysis.cjs');const loaded=engine.loadedIdentity;
 const file=${JSON.stringify(target)},stat=fs.statSync(file);fs.appendFileSync(file,"\\nthrow new Error('MODIFIED_ENGINE_EXECUTED');\\n");fs.utimesSync(file,stat.atime,stat.mtime);
 assert.deepEqual(parser.analyze('a.js',"import './cached.js';").imports,['./cached.js']);
 assert.equal(require('./src/syntax-engine.cjs').loadedIdentity,loaded);
 assert.throws(()=>prepareNativeSourceSummaries(process.cwd(),['project/a.js']),/engine bytes changed after binding/);
 assert.equal(globalThis.MODIFIED_ENGINE_EXECUTED,undefined);
 `);
});
test('late engine drift rejects both a matching observation and canonical fallback',t=>{
 const root=isolated(t);exercise(root,`
 const provided=prepareNativeSourceSummaries(process.cwd(),['project/a.js']);const reader=nativeSourceSummaryReader(process.cwd(),provided);
 const file='src/source-analysis.cjs';fs.appendFileSync(file,"\\nthrow new Error('MODIFIED_ENGINE_EXECUTED');\\n");
 assert.throws(()=>reader.read('project/a.js',fs.readFileSync('project/a.js')),/engine bytes changed after binding/);
 assert.throws(()=>reader.read('project/new.js',Buffer.from("import './new.js';")),/engine bytes changed after binding/);
 assert.equal(reader.stats.validatedHits,0);assert.equal(reader.stats.freshParses,0);
 `);
});
test('unknown external compiler preload disables observations while preserving legacy parsing',t=>{
 const root=isolated(t);exercise(root,`
 const external=require('typescript');const prepared=prepareNativeSourceSummaries(process.cwd(),['project/a.js']);
 assert.deepEqual(prepared,{used:false,reason:'unbound-cached-syntax-engine'});
 const engine=require('./src/syntax-engine.cjs');assert.equal(engine.typescript,external);assert.equal(engine.loadedIdentity,null);
 assert.deepEqual(engine.analyze('a.js',"import './legacy.js';").imports,['./legacy.js']);
 fs.mkdirSync('project/test');fs.writeFileSync('project/test/a.test.js',"import '../a.js';import test from 'node:test';test('works',()=>{});");fs.writeFileSync('project/tddswarm.config.json',JSON.stringify({analysisCache:{enabled:true}}));
 const project=path.resolve('project'),{buildGraph}=await import('./src/graph.js'),{audit}=await import('./src/audit.js'),{plan}=await import('./src/selector.js'),{routingProposals}=await import('./src/routing-proposals.js'),{fallbackDiagnostics}=await import('./src/fallback-diagnostics.js');
 assert.equal(buildGraph(project).analysisCache.enabled,false);assert.equal(audit(project).testFiles,1);
 assert.equal(routingProposals(project).applied,false);assert.equal(fallbackDiagnostics(project,plan(project,{changed:['a.js']})).applied,false);
 assert.equal(fs.existsSync('project/.tddswarm/analysis-cache'),false);
 const reader=nativeSourceSummaryReader(process.cwd(),prepared);assert.throws(()=>reader.read('project/a.js',fs.readFileSync('project/a.js')),/unbound for fresh native parsing/);
 const legacy=nativeSourceSummaryReader(process.cwd(),prepared,{requireBoundEngine:false});assert.deepEqual(legacy.read('project/a.js',fs.readFileSync('project/a.js')).imports,['./original.js']);assert.equal(legacy.stats.validatedHits,0);assert.equal(legacy.stats.unboundLegacyParses,1);
 `);
});
test('engine mutation during canonical load is rejected after loading without executing altered parser bytes',t=>{
 const root=isolated(t);exercise(root,`
 const original=fs.readFileSync;const implementation=require.resolve('typescript');let reads=0,mutated=false;
 fs.readFileSync=function(file,...args){const bytes=original.call(this,file,...args);if(String(file)===implementation&&++reads===2){fs.appendFileSync('src/source-analysis.cjs',"\\nthrow new Error('MODIFIED_ENGINE_EXECUTED');\\n");mutated=true;}return bytes;};
 try{assert.throws(()=>prepareNativeSourceSummaries(process.cwd(),['project/a.js']),/engine bytes changed after binding/);}finally{fs.readFileSync=original;}
 assert.equal(mutated,true);
 `);
});
test('engine drift during observation production cannot label a cached parse with new bytes',t=>{
 const root=isolated(t);exercise(root,`
 const first=prepareNativeSourceSummaries(process.cwd(),['project/a.js']);assert.equal(first.used,true);
 const original=fs.readFileSync;let mutated=false;
 fs.readFileSync=function(file,...args){const bytes=original.call(this,file,...args);if(String(file)===path.resolve('project/a.js')){fs.appendFileSync('src/source-analysis.cjs',"\\nthrow new Error('MODIFIED_ENGINE_EXECUTED');\\n");mutated=true;}return bytes;};
 try{assert.throws(()=>prepareNativeSourceSummaries(process.cwd(),['project/a.js']),/engine bytes changed after binding/);}finally{fs.readFileSync=original;}
 assert.equal(mutated,true);
 `);
});
