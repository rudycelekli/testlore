import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {UNIMPORT_FACTORY_FILE,UNIMPORT_FACTORY_REVISION,UNIMPORT_FACTORY_SOURCE_SHA256,unimportFactoryRegistrationContract,createUnimportFactoryRegistrationPlugin,invokeReviewedUnimportFactory,reviewedUnimportFactoryIt,validateVitestRegistration,vitestCaseHash} from '../src/vitest-case-contracts.js';
const source=fs.readFileSync(new URL('./fixtures/unimport-factory-registration/original.test.txt',import.meta.url),'utf8');
function profile(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-factory-registration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'test'));fs.writeFileSync(path.join(root,UNIMPORT_FACTORY_FILE),source);return {root,contract:unimportFactoryRegistrationContract(root,{upstreamRevision:UNIMPORT_FACTORY_REVISION,vitestVersion:'5.0.0'})};}
test('source-declared parser closures have distinct identities despite equal names',t=>{
 const {root,contract}=profile(t);assert.equal(vitestCaseHash(source),UNIMPORT_FACTORY_SOURCE_SHA256);assert.equal(contract.rows.length,36);assert.equal(new Set(contract.rows.map(row=>row.registrationId)).size,36);
 assert.equal(contract.factories[1].inputSha256,contract.factories[2].inputSha256);assert.notEqual(contract.factories[1].declarationSha256,contract.factories[2].declarationSha256);
 const plugin=createUnimportFactoryRegistrationPlugin(root,contract),code=plugin.transform(source,path.join(root,UNIMPORT_FACTORY_FILE)).code;
 assert.equal((code.match(/__testloreFactory\(testWith,/g)||[]).length,3);assert.equal((code.match(/__testloreFactoryIt\(it,name,parse,/g)||[]).length,12);
 // All assertion expressions and callback bodies are preserved. Only registration
 // callees, factory context transport and one helper import are changed.
 assert.equal((code.match(/expect\(/g)||[]).length,(source.match(/expect\(/g)||[]).length);
 assert.equal(fs.readFileSync(path.join(root,UNIMPORT_FACTORY_FILE),'utf8'),source);
 assert.throws(()=>plugin.transform(source+'\n',path.join(root,UNIMPORT_FACTORY_FILE)),/source drift/);
 fs.appendFileSync(path.join(root,UNIMPORT_FACTORY_FILE),'\n');assert.throws(()=>unimportFactoryRegistrationContract(root,{upstreamRevision:UNIMPORT_FACTORY_REVISION,vitestVersion:'5.0.0'}),/source changed/);
});
test('actual closure reference survives runtime registration; same-label substitution fails as native case',async t=>{
 const {contract}=profile(t),records=[],it=(title,options,callback)=>records.push({title,options,callback});let calls=0;
 const parserA=()=>1,parserB=()=>2;
 for(const [index,parse] of [[1,parserA],[2,parserB]])invokeReviewedUnimportFactory((name,actual,context)=>{
  const row=contract.rows[index*12];reviewedUnimportFactoryIt(it,name,actual,context,row.declarationRowSha256,contract)('scopes',()=>{assert.equal(actual,parse);calls++;});
 },'oxc',parse,contract.factories[index].declarationSha256,contract);
 assert.equal(records.length,2);assert.notEqual(records[0].options.meta.testloreVitestRegistration.registrationId,records[1].options.meta.testloreVitestRegistration.registrationId);
 for(const row of records){assert.equal(validateVitestRegistration(row.options.meta.testloreVitestRegistration,contract),true);await row.callback();}assert.equal(calls,2);
 let context;invokeReviewedUnimportFactory((_name,_parse,value)=>context=value,'oxc',parserA,contract.factories[1].declarationSha256,contract);
 for(const [name,parse,ctx,title] of [['oxc',parserB,context,'scopes'],['acorn',parserA,context,'scopes'],['oxc',parserA,{},'scopes'],['oxc',parserA,context,'invented title']]){
  reviewedUnimportFactoryIt(it,name,parse,ctx,contract.rows[12].declarationRowSha256,contract)(title,()=>{throw Error('must not execute changed registration');});const row=records.at(-1);assert.equal(row.options.meta.testloreVitestRegistration.valid,false);await assert.rejects(async()=>row.callback(),/registration evidence rejected/);
 }
 assert.throws(()=>invokeReviewedUnimportFactory(()=>{},'oxc',parserA,'0'.repeat(64),contract),/invocation differs/);
 const altered=structuredClone(contract);altered.rows[0].registrationId='0'.repeat(64);assert.throws(()=>validateVitestRegistration(records[0].options.meta.testloreVitestRegistration,altered),/Invalid reviewed/);
});

test('only the exact observational output and actual minted plugin object can be admitted',async t=>{
 const {root,contract}=profile(t),{isReviewedUnimportFactoryPlugin,unimportFactoryObserverConfigSource}=await import('../src/vitest-case-contracts.js');
 const plugin=createUnimportFactoryRegistrationPlugin(root,contract),code=plugin.transform(source,path.join(root,UNIMPORT_FACTORY_FILE)).code;
 assert.equal(plugin.transform(code,path.join(root,UNIMPORT_FACTORY_FILE)),undefined);
 assert.throws(()=>plugin.transform(code+'\n// forged observer marker',path.join(root,UNIMPORT_FACTORY_FILE)),/source drift/);
 assert.equal(Object.isFrozen(plugin),true);assert.throws(()=>{plugin.transform=()=>({code:'arbitrary replacement'});},TypeError);assert.throws(()=>Object.defineProperty(plugin,'name',{value:'forged'}),TypeError);assert.equal(isReviewedUnimportFactoryPlugin(plugin,root,contract),true);assert.equal(isReviewedUnimportFactoryPlugin({name:plugin.name},root,contract),false);assert.equal(isReviewedUnimportFactoryPlugin({...plugin},root,contract),false);
 const changed=structuredClone(contract);changed.sourceSha256='0'.repeat(64);assert.equal(isReviewedUnimportFactoryPlugin(plugin,root,changed),false);
 const observer=unimportFactoryObserverConfigSource(root);assert.ok(observer.includes("import original from './vitest.config.ts'"));assert.ok(observer.includes('await import(String('));assert.equal(observer,unimportFactoryObserverConfigSource(root));
});
