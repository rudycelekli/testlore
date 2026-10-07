#!/usr/bin/env node
// Constructed boundary cases are labeled separately from a pinned public bugfix inverse.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { digest } from '../src/provenance.js';

const repository = fileURLToPath(new URL('../',import.meta.url));
const fixRevision = '189f82c965d673b354483a1f2d8ac78c4405b6d4';
const git = (root,...args) => execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{encoding:'utf8',timeout:10000});
const write = (root,file,content) => { const output=path.join(root,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,typeof content==='string'?content:JSON.stringify(content)); };
const commit = root => { git(root,'add','.');git(root,'commit','-m','Constructed qualification revision');return git(root,'rev-parse','HEAD').trim(); };
function initialize(root) { fs.mkdirSync(root);git(root,'init','-b','main');git(root,'config','user.name','TestLore Qualification');git(root,'config','user.email','qualification@localhost');write(root,'package.json',{type:'module'});write(root,'.gitignore','node_modules\n.tddswarm/\n'); }
const origin = notes => ({kind:'authored',maintainer:'TestLore project',independenceNotes:notes+' Constructed by the tool maintainers; not external maintainer evidence or real application history.'});

export function createRegressionFixtures(directory, {framework='vitest'}={}) {
  if(!['node','vitest'].includes(framework))throw new Error('Fixture framework must be node or vitest');
  fs.mkdirSync(directory);const root=path.join(directory,'boundaries');initialize(root);
  const header=framework==='vitest'?"import {test,expect} from 'vitest';import assert from 'node:assert/strict';":"import test from 'node:test';import assert from 'node:assert/strict';";
  const testFile=(name,imports,body)=>write(root,`test/${name}.test.js`,header+imports+`test('${name}',()=>{${body}});`);
  write(root,'packages/math/package.json',{type:'module',name:'@corpus/math',exports:'./index.js'});
  write(root,'packages/math/index.js','export const tax = 20;');
  write(root,'src/price.js',"import {tax} from '../packages/math/index.js';export const price = 100 + tax;");
  write(root,'src/doubler.js','export const double = n => n * 2;');
  write(root,'assets/caption.json','{"caption":"Ship with confidence"}');
  write(root,'assets/theme.css','color: #12abcd;');
  write(root,'config/service.json','{"region":"eu"}');
  write(root,'src/route.js',"import fs from 'node:fs';export function render(){const content=JSON.parse(fs.readFileSync('assets/caption.json','utf8'));const style=fs.readFileSync('assets/theme.css','utf8');const service=JSON.parse(fs.readFileSync('config/service.json','utf8'));return {caption:content.caption,style,region:service.region};}");
  write(root,'src/optional.js','export const enabled = true;');
  write(root,'src/availability.js',"import fs from 'node:fs';export const available=()=>fs.existsSync('src/optional.js');");
  testFile('workspace-tax',"import {price} from '../src/price.js';",'assert.equal(price,120);');
  testFile('arithmetic-contract',"import {double} from '../src/doubler.js';",'assert.equal(double(7),14);assert.equal(double(-1),-2);');
  testFile('landing-caption',"import {render} from '../src/route.js';","assert.equal(render().caption,'Ship with confidence');");
  testFile('landing-style',"import {render} from '../src/route.js';","assert.equal(render().style,'color: #12abcd;');");
  testFile('service-region',"import {render} from '../src/route.js';","assert.equal(render().region,'eu');");
  testFile('optional-availability',"import {available} from '../src/availability.js';",'assert.equal(available(),true);');
  for(let i=0;i<6;i++){write(root,`src/unrelated-${i}.js`,`export const value = ${i};`);testFile(`unrelated-${i}`,`import {value} from '../src/unrelated-${i}.js';`,`assert.equal(value,${i});`);}
  const base=commit(root);fs.renameSync(path.join(root,'src/doubler.js'),path.join(root,'src/arithmetic.js'));
  const testPath='test/arithmetic-contract.test.js';write(root,testPath,fs.readFileSync(path.join(root,testPath),'utf8').replace('../src/doubler.js','../src/arithmetic.js'));
  const renamed=commit(root);fs.unlinkSync(path.join(root,'src/optional.js'));const deleted=commit(root);write(root,'src/optional.js','export const enabled = true;');commit(root);
  const changes=[
    {name:'arithmetic-fault',file:'src/arithmetic.js',before:'n * 2',after:'n * 3',expectedFailure:true},
    {name:'caption-fault',file:'assets/caption.json',before:'Ship with confidence',after:'Ship without checks',expectedFailure:true},
    {name:'style-fault',file:'assets/theme.css',before:'#12abcd',after:'#ffffff',expectedFailure:true},
    {name:'service-fault',file:'config/service.json',before:'"eu"',after:'"us"',expectedFailure:true},
    {name:'workspace-fault',file:'packages/math/index.js',before:'tax = 20',after:'tax = 25',expectedFailure:true},
    {name:'source-rename',kind:'history',baseRevision:base,headRevision:renamed,expectedFailure:false},
    {name:'source-deletion',kind:'history',baseRevision:renamed,headRevision:deleted,expectedFailure:true}
  ];
  let runner=[process.execPath,'--test','{files}'];
  if(framework==='vitest') {const require=createRequire(import.meta.url),cli=path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs');runner=[process.execPath,cli,'run','--maxWorkers=1','{files}'];fs.symlinkSync(path.join(repository,'node_modules'),path.join(root,'node_modules'),'dir');}
  const names=['arithmetic-contract','landing-caption','landing-style','service-region','workspace-tax',null,'optional-availability'];
  const labels=changes.map((change,index)=>({project:'boundaries',change:change.name,expectedFailureNames:change.expectedFailure?[names[index]]:[],origin:origin('Assertions use explicit behavior expectations and are executed independently by the native full suite. Browser-like rendering is a Node/Vitest contract, not a Playwright browser exercise.')}));
  const bugRoot=path.join(directory,'public-path-bug');initialize(bugRoot);
  const parentRevision=git(repository,'rev-parse',fixRevision+'^').trim();
  const fixed=git(repository,'show',fixRevision+':src/adapters/codex.js'),buggy=git(repository,'show',parentRevision+':src/adapters/codex.js');
  write(bugRoot,'src/adapters/codex.js',fixed);write(bugRoot,'src/adapters/codex-protocol.js',git(repository,'show',fixRevision+':src/adapters/codex-protocol.js'));
  write(bugRoot,'test/child-path.test.js',String.raw`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {codexRequest,runCodex} from '../src/adapters/codex.js';
test('child-relative PATH resolves launcher from child cwd',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-independent-path-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'bin'));const reply={tasks:[{subject:'src/a.js',instructions:'Verify explicit contract'}]};const events=[{type:'thread.started',thread_id:'fixture'},{type:'turn.started'},{type:'item.completed',item:{id:'answer',type:'agent_message',text:JSON.stringify(reply)}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}];const script='#!'+process.execPath+'\nconst fs=require("node:fs");const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf("--output-last-message")+1],'+JSON.stringify(JSON.stringify(reply))+');process.stdout.write('+JSON.stringify(events.map(e=>JSON.stringify(e)+'\n').join(''))+');';fs.writeFileSync(path.join(root,'bin/codex'),script);fs.chmodSync(path.join(root,'bin/codex'),0o755);const req=codexRequest({role:'architect',requirements:'Relative PATH must be interpreted from the supplied child working directory, as for process spawn.'},root);const {value,audit}=await runCodex(req.args,req.prompt,root,{PATH:'bin'}, {timeoutMs:3000});assert.deepEqual(value,reply);assert.equal(audit.requestedExecutablePath,path.join(root,'bin/codex'));});`);
  commit(bugRoot);
  const inverse={name:'child-path-inverse',file:'src/adapters/codex.js',before:fixed,after:buggy,expectedFailure:true};
  labels.push({project:'public-path-bug',change:inverse.name,expectedFailureNames:['child-relative PATH resolves launcher from child cwd'],origin:{kind:'public-bugfix-inversion',maintainer:'TestLore project',repository:'https://github.com/rudycelekli/testlore',fixRevision,parentRevision,fixedSourceHash:digest(fixed),buggySourceHash:digest(buggy),independenceNotes:'Actual public source fix inverted byte-for-byte. Oracle separately specifies child working-directory PATH behavior using a mock native launcher; no provider is invoked. Same-project history and tool-authored oracle, not an external maintainer or untouched application sample.'}});
  for(const label of labels){const source=label.project==='boundaries'?root:bugRoot;const filenames=label.project==='public-path-bug'?['test/child-path.test.js']:fs.readdirSync(path.join(root,'test')).map(file=>'test/'+file);label.oracleFiles=filenames.map(file=>({path:file,sha256:digest(fs.readFileSync(path.join(source,file)))}));}
  return {schemaVersion:1,pilot:{schemaVersion:1,repetitions:2,timeoutMs:15000,projects:[{name:'boundaries',root,scope:'12 exact native contract cases; runtime files and workspace boundaries; constructed Git rename/deletion',config:{adapter:framework,discovery:'native',runner},changes},{name:'public-path-bug',root:bugRoot,scope:'One Node assertion about public fixed child PATH behavior; mocked CLI, no AI calls',config:{adapter:'node',discovery:'native',runner:[process.execPath,'--test','{files}']},changes:[inverse]}]},labels};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--directory'||args[2]!=='--manifest')throw new Error('Use --directory NEW_DIRECTORY --manifest NEW_MANIFEST.json');const manifest=createRegressionFixtures(path.resolve(args[1]));fs.writeFileSync(args[3],JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Created local labeled corpus; source copies and case labels remain private.');}catch(error){console.error(error.message);process.exitCode=1;}}
