import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture,write} from './helpers.js';
import {qualifyBugRecipe,captureBugProbeSource} from '../src/bug-recipes.js';
import {investigateBugs,readInvestigationReport,planBugInvestigation} from '../src/bug-investigation.js';
import {installBundledBugRecipes} from '../src/bug-catalog.js';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');

async function observed(t){
 const root=fixture(t,{'entry.mjs':'export function count(x){return x.length}','original/entry.mjs':'export function count(x){return x.length}','fixed/entry.mjs':'export function count(x){return Array.from(x).length}','expectation.txt':'The public count function counts Unicode code points.'});
 const recipe={schemaVersion:1,kind:'bug-recipe',id:'codepoint-count',family:'unicode-boundary',provenance:{repository:'https://github.com/example/count',baseRevision:'a'.repeat(40),fixedRevision:'b'.repeat(40),evidenceClass:'constructed'},contract:{text:'Count codepoints.',sourceUrl:'https://example.org/spec',sourceSha256:hash('Count codepoints.'),independence:'independent-specification'},probe:{exportName:'count',cases:[{id:'astral',args:['😀'],expect:{kind:'equals',value:1}}]},applicability:{requiredIdentifiers:['count']}};
 write(root,'recipe.json',recipe);await qualifyBugRecipe({recipe,original:{root:path.join(root,'original'),module:'entry.mjs',files:['entry.mjs']},fixed:{root:path.join(root,'fixed'),module:'entry.mjs',files:['entry.mjs']},outputRoot:path.join(root,'qualification')});
 const manifest={schemaVersion:1,kind:'bug-investigation-manifest',recipes:[{path:'recipe.json',sha256:hash(fs.readFileSync(path.join(root,'recipe.json'))),qualification:{path:'qualification/qualification.json',sha256:hash(fs.readFileSync(path.join(root,'qualification/qualification.json')))}}],targets:[{id:'current',module:'entry.mjs',files:['entry.mjs'],tests:[],contracts:[{recipeId:recipe.id,recipeSha256:hash(recipe),sourceSha256:captureBugProbeSource(root,{module:'entry.mjs',files:['entry.mjs']}).sourceSha256,expectation:{path:'expectation.txt',sha256:hash(fs.readFileSync(path.join(root,'expectation.txt')))},reviewer:'contract-owner'}]}],budget:{totalMs:10000,timeoutMs:1000,maxInvestigations:1}};
 write(root,'tddswarm.probes.json',manifest);const result=await investigateBugs(root,{execute:true});assert.equal(result.summary.reproduced,1);return {root,result};
}
function forge(root,file,callback){const report=JSON.parse(fs.readFileSync(path.join(root,file)));delete report.integrity;callback(report);report.integrity=hash(report);write(root,'forged.json',report);return report;}

test('independent adversary cannot relabel an old raw probe as fresh changed source',async t=>{
 const {root,result}=await observed(t);write(root,'entry.mjs','export function count(x){return Array.from(x).length}');
 assert.equal(readInvestigationReport(root,result.receipt).stale,true);
 forge(root,result.receipt,report=>report.sourceBinding.files.find(item=>item.path==='entry.mjs').sha256=hash(fs.readFileSync(path.join(root,'entry.mjs'))));
 assert.throws(()=>readInvestigationReport(root,'forged.json'),/source|closure|binding|observation/i);
});
test('independent adversary cannot rewrite manifest identity while preserving a sealed observation',async t=>{
 const {root,result}=await observed(t);forge(root,result.receipt,report=>report.manifestSha256='d'.repeat(64));
 assert.throws(()=>readInvestigationReport(root,'forged.json'),/manifest|binding|identity|source/i);
});
test('valid expanded declaration cannot emit a plan beyond its readable evidence byte budget',async t=>{
 const {root}=await observed(t),manifest=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.probes.json'))),initial=JSON.parse(fs.readFileSync(path.join(root,'recipe.json')));
 for(let i=1;i<3;i++){const recipe={...initial,id:'codepoint-count-'+i};write(root,`recipe-${i}.json`,recipe);await qualifyBugRecipe({recipe,original:{root:path.join(root,'original'),module:'entry.mjs',files:['entry.mjs']},fixed:{root:path.join(root,'fixed'),module:'entry.mjs',files:['entry.mjs']},outputRoot:path.join(root,`qualification-${i}`)});manifest.recipes.push({path:`recipe-${i}.json`,sha256:hash(fs.readFileSync(path.join(root,`recipe-${i}.json`))),qualification:{path:`qualification-${i}/qualification.json`,sha256:hash(fs.readFileSync(path.join(root,`qualification-${i}/qualification.json`)))}});}
 const files=['entry.mjs'];for(let i=0;i<127;i++){const file='scope/'+('x'.repeat(180))+'/'+('y'.repeat(180))+`/data-${i}.json`;write(root,file,'{}');files.push(file);}
 manifest.targets=Array.from({length:32},(_,i)=>({id:'scope-'+i,module:'entry.mjs',files,tests:[],contracts:[]}));write(root,'tddswarm.probes.json',manifest);
 assert.throws(()=>planBugInvestigation(root),/budget|byte|candidate|limit|MiB|hypotheses/i);
});
test('catalog copy rejects different admitted bytes after historical qualification',t=>{
 const root=fixture(t),member=path.resolve('src/probe-catalog/qualified/historical-whitespace-classification/recipe.json');
 const open=fs.openSync,read=fs.readSync,close=fs.closeSync,descriptors=new Map();let opens=0,injected=false;
 fs.openSync=function(file,...args){const fd=open.call(this,file,...args);if(path.resolve(String(file))===member)descriptors.set(fd,++opens);return fd;};
 fs.closeSync=function(fd,...args){descriptors.delete(fd);return close.call(this,fd,...args);};
 fs.readSync=function(fd,buffer,offset,length,position){const count=read.call(this,fd,buffer,offset,length,position);if(descriptors.get(fd)===3&&count&&!injected){const at=buffer.indexOf('Whitespace-only',offset);assert.ok(at>=offset);buffer[at]=88;injected=true;}return count;};
 // Fault injection simulates changed recipe bytes on the later capture read;
 // bundled public files remain untouched, and native filesystem metadata stays valid.
 try{assert.throws(()=>installBundledBugRecipes(root),/hash mismatch/);assert.equal(injected,true);assert.equal(fs.existsSync(path.join(root,'testlore/recipes')),false);}finally{fs.openSync=open;fs.readSync=read;fs.closeSync=close;}
});
