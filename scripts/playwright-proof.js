#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {discover,execute} from '../src/execution.js';
import {plan} from '../src/selector.js';
import {stagePatch,validateCandidates} from '../src/candidates.js';
import {snapshot,freshness,digest} from '../src/provenance.js';

const VERSION='1.63.0';
const REQUIREMENTS='The /landing route renders a visible heading exactly Community tools and its paragraph exactly Welcome builders. The /pricing route renders a visible heading exactly Simple pricing. Routing and assertions must preserve the unrelated pricing case.';
const LANDING='<h1>Community tools</h1><p>Build together</p>';
const EDITED='<h1>Community tools</h1><p>Welcome builders</p>';
const DEFECT='<h1>Incorrect heading</h1><p>Welcome builders</p>';
const PRICING='<h1>Simple pricing</h1><p>Free for the community</p>';
const LANDING_TEST=`import {test,expect} from '@playwright/test';test('landing heading matches independent copy specification',async({page})=>{await page.goto(process.env.TESTLORE_FIXTURE_URL+'/landing');await expect(page.getByRole('heading')).toHaveText('Community tools');});\n`;
const CANDIDATE=LANDING_TEST+`test('landing paragraph matches independent copy specification',async({page})=>{await page.goto(process.env.TESTLORE_FIXTURE_URL+'/landing');await expect(page.locator('p')).toHaveText('Welcome builders');});\n`;
const PRICING_TEST=`import {test,expect} from '@playwright/test';test('pricing heading matches independent copy specification',async({page})=>{await page.goto(process.env.TESTLORE_FIXTURE_URL+'/pricing');await expect(page.getByRole('heading')).toHaveText('Simple pricing');});\n`;
// Kept as a controlled external fixture dependency: every copied workspace's
// globalSetup starts its own local server and reads that workspace's HTML.
const SERVER=`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';export default async function(){const root=process.cwd();const server=http.createServer((req,res)=>{const name=req.url==='/landing'?'landing':req.url==='/pricing'?'pricing':null;if(!name){res.writeHead(404);res.end();return;}res.setHeader('content-type','text/html');res.end(fs.readFileSync(path.join(root,'routes',name+'.html')));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.TESTLORE_FIXTURE_URL='http://127.0.0.1:'+server.address().port;return async()=>await new Promise(resolve=>server.close(resolve));}\n`;
const write=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
function sdk(moduleRoot){
  const require=createRequire(path.join(path.resolve(moduleRoot),'package.json'));
  let manifest;try{manifest=require.resolve('@playwright/test/package.json');}catch{throw new Error('Install project-local @playwright/test@1.63.0 and Chromium first, or supply --module-root. This proof never installs dependencies or browsers.');}
  const pkg=JSON.parse(fs.readFileSync(manifest));if(pkg.version!==VERSION)throw new Error(`Proof requires @playwright/test@${VERSION}; found ${pkg.version}`);
  return {moduleRoot:path.dirname(path.dirname(path.dirname(path.dirname(manifest)))),manifest,require};
}
function normalize(value,roots){
  if(Array.isArray(value))return value.map(v=>normalize(v,roots));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v,roots)]));
  if(typeof value!=='string')return value;
  let text=value;for(const [root,label]of roots)if(root)text=text.split(root).join(label);
  return text.replace(/\/(?:private\/)?var\/folders\/[^\s:'"\n]+\/T\/(?:tddswarm|testlore)-[^/\s:'"\n]+/g,'<scratch>').replace(/\/(?:private\/)?tmp\/(?:tddswarm|testlore)-[^/\s:'"\n]+/g,'<scratch>');
}
function measured(root,files,config){
  const before=snapshot(root,config),report=execute(root,files,config,{capture:true,timeoutMs:30000});
  const stable=freshness(before,snapshot(root,config));return {...report,provenance:before,stable,complete:report.complete&&stable.fresh};
}
function genuineFailure(report){return report.complete&&report.exitCode!==0&&report.tests.filter(t=>t.status==='failed').length===1&&report.tests.some(t=>t.file==='browser/landing.spec.js'&&t.title==='landing heading matches independent copy specification'&&t.status==='failed'&&t.attempts.some(a=>a.errors.some(e=>/toHaveText/.test(e.message||''))));}

/** Controlled Chromium compatibility and routing proof, not broad safety certification. */
export function playwrightProof({moduleRoot=process.cwd(),rawDirectory,channel=process.env.TESTLORE_BROWSER_CHANNEL}={}){
  if(channel&&!['chrome','msedge','chromium'].includes(channel))throw new Error('Unsupported proof browser channel');
  const installed=sdk(moduleRoot),root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-playwright-proof-'));
  const repository=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
  const roots=[[process.execPath,'<node>'],[fs.realpathSync(root),'<fixture>'],[root,'<fixture>'],[fs.realpathSync(installed.moduleRoot),'<tooling>'],[installed.moduleRoot,'<tooling>'],[repository,'<testlore>']];
  try{
    fs.mkdirSync(path.join(root,'node_modules','@playwright'),{recursive:true});
    for(const name of ['@playwright/test','playwright','playwright-core'])fs.symlinkSync(path.dirname(installed.require.resolve(name+'/package.json')),path.join(root,'node_modules',name),'dir');
    write(root,'node_modules/testlore-fixture-server/package.json',{name:'testlore-fixture-server',version:'1.0.0',type:'module',main:'index.js'});write(root,'node_modules/testlore-fixture-server/index.js',SERVER);
    const config={adapter:'playwright',discovery:'native',runner:[process.execPath,'node_modules/@playwright/test/cli.js','test','{files}'],browser:{closedWorld:true,routes:{'/landing':{tests:['browser/landing.spec.js'],inputs:['routes/landing.html']},'/pricing':{tests:['browser/pricing.spec.js'],inputs:['routes/pricing.html']}}}};
    write(root,'package.json',{name:'testlore-playwright-fixture',private:true,type:'module',dependencies:{'@playwright/test':VERSION,'testlore-fixture-server':'1.0.0'}});
    write(root,'tddswarm.config.json',config);write(root,'tddswarm.requirements.md',REQUIREMENTS);
    write(root,'playwright.config.mjs',`export default {testDir:'./browser',globalSetup:'./globalSetup.mjs',workers:1,retries:0,timeout:5000,expect:{timeout:1000},projects:[{name:'chromium',use:{browserName:'chromium',headless:true,channel:${JSON.stringify(channel)}}}]};\n`);
    write(root,'globalSetup.mjs',`export {default} from 'testlore-fixture-server';\n`);
    write(root,'routes/landing.html',LANDING);write(root,'routes/pricing.html',PRICING);write(root,'browser/landing.spec.js',LANDING_TEST);write(root,'browser/pricing.spec.js',PRICING_TEST);
    const discovery=discover(root,config),baseline=measured(root,discovery.files,config);
    write(root,'routes/landing.html',EDITED);
    const selection=plan(root,{changed:['routes/landing.html']}),full=measured(root,discovery.files,config),subset=measured(root,selection.selected,config);
    const staged=stagePatch(root,{files:[{path:'browser/landing.spec.js',content:CANDIDATE}],requirements:REQUIREMENTS,review:{accepted:true,findings:['Controlled manually authored candidate; explicit copy specification and original cases retained.'],oracle:{independent:true,basis:[REQUIREMENTS]}},heldOutDefects:[{name:'incorrect landing heading',path:'routes/landing.html',content:DEFECT}]});
    const validation=validateCandidates(root,staged.id,{timeoutMs:30000});
    const unapplied=fs.readFileSync(path.join(root,'browser/landing.spec.js'),'utf8')===LANDING_TEST;
    write(root,'routes/landing.html',DEFECT);
    const faultFull=measured(root,discovery.files,config),faultSubset=measured(root,selection.selected,config);
    const fullFailed=faultFull.tests.filter(t=>t.status==='failed'),subsetFailed=faultSubset.tests.filter(t=>t.status==='failed');
    const sameFault=fullFailed.length===1&&subsetFailed.length===1&&fullFailed[0].id===subsetFailed[0].id;
    const green=r=>r.complete&&r.exitCode===0&&r.tests.length>0&&r.tests.every(t=>t.status==='passed');
    const passed=discovery.complete&&discovery.files.length===2&&green(baseline)&&selection.mode==='affected'&&selection.selected.length===1&&selection.selected[0]==='browser/landing.spec.js'&&green(full)&&green(subset)&&genuineFailure(faultFull)&&genuineFailure(faultSubset)&&sameFault&&validation.accepted&&validation.original.complete&&validation.candidate.complete&&validation.defects.length===1&&validation.defects[0].demonstrated&&validation.defects[0].caught&&unapplied;
    const fixture={requirements:REQUIREMENTS,source:{'routes/landing.html':LANDING,'routes/pricing.html':PRICING},edit:EDITED,defect:DEFECT,original:{'browser/landing.spec.js':LANDING_TEST,'browser/pricing.spec.js':PRICING_TEST},candidate:CANDIDATE,server:SERVER,config};
    const raw=normalize({fixture,discovery,baseline,selection,full,subset,faultFull,faultSubset,validation},roots),rawArtifacts={};
    if(rawDirectory){fs.mkdirSync(rawDirectory,{recursive:true});for(const [name,data]of Object.entries(raw)){const file=name+'.json',content=JSON.stringify(data,null,2)+'\n';fs.writeFileSync(path.join(rawDirectory,file),content);rawArtifacts[file]={sha256:digest(content)};}}
    const browsers=JSON.parse(fs.readFileSync(path.join(path.dirname(installed.require.resolve('playwright-core/package.json')),'browsers.json')));
    return {schemaVersion:1,scope:'Controlled headless Chromium localhost routes, one declared copy change and one planted heading defect; manually authored candidate/oracle',generatedAt:new Date().toISOString(),passed,applied:false,unapplied,node:process.version,library:{name:'@playwright/test',version:VERSION,channel:channel||'bundled-chromium',packageHash:digest(fs.readFileSync(installed.manifest)),chromium:browsers.browsers.find(b=>b.name==='chromium')},fixtureHash:digest(raw.fixture),routing:{mode:selection.mode,selected:selection.selected,total:selection.total,omitted:selection.omitted,warnings:selection.warnings,fullCases:full.tests.length,subsetCases:subset.tests.length},fault:{fullCaught:genuineFailure(faultFull),subsetCaught:genuineFailure(faultSubset),sameNamedCase:sameFault,fullFailed:fullFailed.map(t=>t.name),subsetFailed:subsetFailed.map(t=>t.name)},candidate:{accepted:validation.accepted,reasons:validation.reasons,originalComplete:validation.original?.complete,candidateComplete:validation.candidate?.complete,originalCases:validation.original?.tests?.length,candidateCases:validation.candidate?.tests?.length,heldOutDefects:validation.defects.map(d=>({name:d.name,demonstrated:d.demonstrated,caught:d.caught}))},rawArtifacts,limitations:['Two controlled routes and one fixed defect do not certify general browser fault recall or deployment safety.','This controlled fixture explicitly asserts browser.closedWorld:true for its complete manually scoped route inputs; observations alone never establish that policy.','Candidate/oracle/reviewer fixtures are manually authored; no model or provider API is invoked.','Trusted project/dependency code executes; disposable file copies are not a security sandbox.','No wall-clock speed claim; native discovery and browser startup add overhead.']};
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--module-root','--output','--raw-directory','--channel'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Usage: node scripts/playwright-proof.js [--module-root DIR] [--output FILE] [--raw-directory DIR]');options[process.argv[i].slice(2)]=process.argv[i+1];}const report=playwrightProof({moduleRoot:options['module-root']||process.cwd(),rawDirectory:options['raw-directory'],channel:options.channel||process.env.TESTLORE_BROWSER_CHANNEL}),text=JSON.stringify(report,null,2)+'\n';if(options.output){fs.mkdirSync(path.dirname(path.resolve(options.output)),{recursive:true});fs.writeFileSync(options.output,text);}process.stdout.write(text);process.exitCode=report.passed?0:1;}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
