import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,write,twoModules,commit} from './helpers.js';
import {plan,run,snapshot,ingestRuntime,captureRuntime,qualityEvidence,ingestQuality} from '../src/index.js';
import {serviceInputs} from '../src/inputs.js';
import {freshness} from '../src/provenance.js';

test('browser route assets and contracts select only declared consumers',t=>{
 const root=fixture(t,{...twoModules,'public/copy.json':'{}','public/style.css':'body{}','contracts/api.json':'{}','tddswarm.config.json':{browser:{routes:{'/':{tests:['test/a.test.js'],inputs:['public/copy.json','public/style.css']}}},contracts:{'contracts/api.json':['test/b.test.js']}}});
 for(const changed of ['public/copy.json','public/style.css'])assert.deepEqual(plan(root,{changed:[changed]}).selected,['test/a.test.js']);
 assert.deepEqual(plan(root,{changed:['contracts/api.json']}).selected,['test/b.test.js']);
 assert.equal(plan(root,{changed:['public/unknown.css']}).mode,'full');
});
test('service version changes retain consumers even when source is unchanged',t=>{
 const config={services:{api:{probe:[process.execPath,'-e',"process.stdout.write(require('fs').readFileSync('.tddswarm/version','utf8'))"],tests:['test/a.test.js']}}};
 const root=fixture(t,{...twoModules,'.tddswarm/version':'v1','tddswarm.config.json':config});commit(root);
 assert.deepEqual(plan(root,{changed:[]}).selected,['test/a.test.js']);
 assert.equal(run(root,{full:true,capture:true}).exitCode,0);
 assert.deepEqual(plan(root,{changed:[]}).selected,[]);
 write(root,'.tddswarm/version','v2');
 assert.deepEqual(plan(root,{changed:[]}).selected,['test/a.test.js']);
 assert.equal(serviceInputs(root,config).values['service:api'].includes('v2'),false);
 assert.equal(Object.keys(serviceInputs(root,{env:{TDDSWARM_TEST_SERVICE:'configured'},services:{api:{env:'TDDSWARM_TEST_SERVICE',tests:['test/a.test.js']}}}).values).length,1);
});
test('unavailable or failing service probes force full selection',t=>{
 for(const service of [{env:'TDDSWARM_MISSING_928383',tests:['test/a.test.js']},{probe:[process.execPath,'-e','process.exit(1)'],tests:['test/a.test.js']}]){
  const root=fixture(t,{...twoModules,'tddswarm.config.json':{services:{api:service}}});
  assert.equal(plan(root,{changed:[]}).mode,'full');
 }
});
test('service drift during execution cannot be stored as passing evidence',t=>{
 const root=fixture(t,{...twoModules,'.tddswarm/version':'v1','test/a.test.js':twoModules['test/a.test.js']+"\nimport fs from 'node:fs';fs.writeFileSync('.tddswarm/version','v2');",'tddswarm.config.json':{services:{api:{probe:[process.execPath,'-e',"process.stdout.write(require('fs').readFileSync('.tddswarm/version','utf8'))"],tests:['test/a.test.js']}}}});commit(root);
 const result=run(root,{full:true,capture:true});assert.equal(result.exitCode,2);assert.equal(result.complete,false);assert.equal(fs.existsSync(path.join(root,'.tddswarm/services.json')),false);
});
test('imported runtime reports require full scope, trusted provenance, and known paths',t=>{
 const config={runtime:{enabled:true,closedWorld:true}};const root=fixture(t,{...twoModules,'tddswarm.config.json':config});const before=snapshot(root,config);
 const report={schemaVersion:1,type:'runtime',complete:true,tests:['test/a.test.js','test/b.test.js'],observations:{'test/a.test.js':{complete:true,dependencies:['src/a.js']},'test/b.test.js':{complete:true,dependencies:['src/b.js']}},inputs:{}};
 write(root,'.tddswarm/custom.json',report);assert.equal(ingestRuntime(root,'.tddswarm/custom.json',{provenance:before}).complete,true);
 report.observations['test/a.test.js'].dependencies.push('../../outside');write(root,'.tddswarm/custom.json',report);assert.throws(()=>ingestRuntime(root,'.tddswarm/custom.json',{provenance:before}),/Invalid runtime/);
});
test('editing an evidence receipt or raw artifact invalidates its measured status',t=>{
 const root=fixture(t,twoModules);const before=snapshot(root);write(root,'.tddswarm/report.json',{files:{a:{mutants:[{status:'Survived'}]}}});
 ingestQuality(root,'mutation','.tddswarm/report.json',{provenance:before});const file=path.join(root,'.tddswarm/evidence/quality/mutation.json');const record=JSON.parse(fs.readFileSync(file));record.metrics.score=100;fs.writeFileSync(file,JSON.stringify(record));assert.equal(qualityEvidence(root).mutation.measured,false);
 ingestQuality(root,'mutation','.tddswarm/report.json',{provenance:before});write(root,'.tddswarm/evidence/quality/mutation.raw.json','{}');assert.equal(qualityEvidence(root).mutation.measured,false);
 const corrupt={...before,files:{...before.files,'src/a.js':'invented'}};assert.equal(freshness(corrupt,before).fresh,false);
});
test('changing captured dependency membership cannot authorize omissions',async t=>{
 const root=fixture(t,{...twoModules,'tddswarm.config.json':{runtime:{enabled:true,closedWorld:true}}});commit(root);await captureRuntime(root);
 const file=path.join(root,'.tddswarm/evidence/runtime.json');const record=JSON.parse(fs.readFileSync(file));record.observations['test/a.test.js'].dependencies=[];fs.writeFileSync(file,JSON.stringify(record));write(root,'src/a.js','export const a=3;');assert.equal(plan(root).mode,'full');
});
