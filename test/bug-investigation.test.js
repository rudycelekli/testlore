import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fixture,write,commit} from './helpers.js';
import {qualifyBugRecipe,captureBugProbeSource} from '../src/bug-recipes.js';
import {planBugInvestigation,investigateBugs,readInvestigationReport,immunityStatus,installInvestigationWorkflow} from '../src/bug-investigation.js';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const cli=path.resolve('src/cli.js');
async function project(t){
 const root=fixture(t,{'package.json':{type:'module'},'src/count.js':'export function count(value){return value.length;}','test/native.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import {count} from '../src/count.js';test('existing ASCII contract',()=>assert.equal(count('abc'),3));",'expectation.md':'count returns Unicode code point count.','original/entry.mjs':'export function count(value){return value.length;}','fixed/entry.mjs':'export function count(value){return Array.from(value).length;}', '.gitignore':'.tddswarm/\n'});
 const recipe={schemaVersion:1,kind:'bug-recipe',id:'unicode-count',family:'unicode-boundary',provenance:{repository:'https://github.com/example/constructed',baseRevision:'a'.repeat(40),fixedRevision:'b'.repeat(40),evidenceClass:'constructed'},contract:{text:'Count Unicode code points.',sourceUrl:'https://example.test/independent-contract',sourceSha256:hash('Count Unicode code points.'),independence:'independent-specification'},probe:{exportName:'count',cases:[{id:'astral-code-point',args:['😀'],expect:{kind:'equals',value:1}},{id:'existing-ascii',args:['abc'],expect:{kind:'equals',value:3}}]},applicability:{requiredIdentifiers:['count']}};
 write(root,'recipe.json',JSON.stringify(recipe,null,2));
 await qualifyBugRecipe({recipe,original:{root:path.join(root,'original'),module:'entry.mjs',files:['entry.mjs']},fixed:{root:path.join(root,'fixed'),module:'entry.mjs',files:['entry.mjs']},outputRoot:path.join(root,'qualification')});
 const manifest={schemaVersion:1,kind:'bug-investigation-manifest',recipes:[{path:'recipe.json',sha256:hash(fs.readFileSync(path.join(root,'recipe.json'))),qualification:{path:'qualification/qualification.json',sha256:hash(fs.readFileSync(path.join(root,'qualification/qualification.json')))}}],targets:[{id:'counter',module:'src/count.js',files:['src/count.js','package.json'],tests:['test/native.test.mjs'],contracts:[{recipeId:recipe.id,recipeSha256:hash(recipe),sourceSha256:captureBugProbeSource(root,{module:'src/count.js',files:['src/count.js','package.json']}).sourceSha256,expectation:{path:'expectation.md',sha256:hash(fs.readFileSync(path.join(root,'expectation.md')))},reviewer:'independent-contract-owner'}]}],budget:{totalMs:10000,timeoutMs:1000,maxInvestigations:3}};
 write(root,'tddswarm.probes.json',manifest);return {root,manifest,recipe};
}

test('planning executes no modules and preserves whitespace-formatted recipe byte identity separately from canonical recipe',async t=>{
 const {root}=await project(t),plan=planBugInvestigation(root);assert.equal(plan.candidates[0].applicable,true);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
 assert.equal(plan.authority.routingOmissions,false);assert.ok(plan.sourceBinding.files.some(row=>row.path==='qualification/original.json'));
});
test('green original suite exposes a new independently approved failure and emits an executable review-only regression',async t=>{
 const {root}=await project(t),original=fs.readFileSync(path.join(root,'test/native.test.mjs'));
 const nativeEnv={...process.env};delete nativeEnv.NODE_TEST_CONTEXT;
 const originalRun=spawnSync(process.execPath,['--test','test/native.test.mjs'],{cwd:root,env:nativeEnv,encoding:'utf8'});assert.equal(originalRun.status,0);assert.match(originalRun.stdout,/# tests 1/);
 const report=await investigateBugs(root,{execute:true});assert.equal(report.summary.reproduced,1);assert.equal(report.exitCode,1);
 const finding=report.findings[0],proposal=JSON.parse(fs.readFileSync(path.join(root,finding.regressionProposal.path)));
 assert.equal(proposal.authority.apply,false);assert.deepEqual(fs.readFileSync(path.join(root,'test/native.test.mjs')),original);
 for(const file of proposal.files)write(root,file.path,file.content);
 const native=spawnSync(process.execPath,['--test',proposal.files[0].path],{cwd:root,env:nativeEnv,encoding:'utf8'});assert.equal(native.status,1,native.stdout+native.stderr+'\n'+proposal.files[0].content);assert.match(native.stdout,/# tests 2/);
 const captured=readInvestigationReport(root,report.receipt);assert.equal(captured.stale,false);
 assert.equal((await immunityStatus(root)).observation.summary.reproduced,1);
});
test('unchanged inputs reuse only complete sealed observations; changed source approvals require fresh review',async t=>{
 const {root}=await project(t),first=await investigateBugs(root,{execute:true}),second=await investigateBugs(root,{execute:true});assert.equal(second.reused,true);assert.equal(second.receipt,first.receipt);
 write(root,'src/count.js','export function count(value){return Array.from(value).length;}');
 assert.equal(readInvestigationReport(root,first.receipt).stale,true);
 const plan=planBugInvestigation(root);assert.equal(plan.candidates[0].applicable,false);assert.match(plan.candidates[0].reason,/stale/);
 const report=await investigateBugs(root,{execute:true});assert.equal(report.summary['not-applicable'],1);assert.equal(report.summary.reproduced,0);
});
test('absent target expectation or missing identifiers abstain rather than inventing a bug',async t=>{
 const {root,manifest}=await project(t);manifest.targets[0].contracts=[];write(root,'tddswarm.probes.json',manifest);assert.match(planBugInvestigation(root).candidates[0].reason,/No independently/);
 write(root,'src/count.js','export function unrelated(value){return value.length;}');assert.match(planBugInvestigation(root).candidates[0].reason,/identifiers/);
});
test('explicit follow-contract approval detects later regressions without silently reusing old source evidence',async t=>{
 const {root,manifest}=await project(t);manifest.targets[0].contracts[0].revisionPolicy='follow-contract';write(root,'tddswarm.probes.json',manifest);
 write(root,'src/count.js','export function count(value){return Array.from(value).length;}');const good=await investigateBugs(root,{execute:true});assert.equal(good.summary.passed,1);
 write(root,'src/count.js','export function count(value){return value.length;}');const faulty=await investigateBugs(root,{execute:true});assert.equal(faulty.reused,undefined);assert.equal(faulty.summary.reproduced,1);assert.notEqual(faulty.findings[0].sourceSha256,good.findings[0].sourceSha256);
 write(root,'expectation.md','A new contract needs review.');assert.throws(()=>planBugInvestigation(root),/hash mismatch/);
});
test('bounded campaign stops unstarted probes and retains incomplete work explicitly',async t=>{
 const {root,manifest}=await project(t);manifest.budget.totalMs=100;write(root,'tddswarm.probes.json',manifest);const report=await investigateBugs(root,{execute:true});assert.equal(report.summary['budget-exhausted'],1);assert.equal(report.exitCode,2);
});
test('a shared pipeline deadline cannot expand a reviewed manifest budget or restart an exhausted campaign',async t=>{
 const {root,manifest}=await project(t);const short=await investigateBugs(root,{execute:true,reuse:false,deadlineMs:100});assert.equal(short.budget.totalMs,100);assert.equal(short.summary['budget-exhausted'],1);assert.equal(short.exitCode,2);
 const limited=await investigateBugs(root,{execute:false,deadlineMs:900000});assert.equal(limited.budget.totalMs,manifest.budget.totalMs);
 await assert.rejects(()=>investigateBugs(root,{execute:true,deadlineMs:0}),/pipeline deadline/);
});
test('sealed summary contradictions and undeclared test associations are refused even if rehashed',async t=>{
 const {root}=await project(t),report=await investigateBugs(root,{execute:true});
 const edit=callback=>{const value=JSON.parse(fs.readFileSync(path.join(root,report.receipt)));delete value.integrity;callback(value);value.integrity=hash(value);write(root,'changed-report.json',value);};
 edit(value=>value.summary.reproduced=0);assert.throws(()=>readInvestigationReport(root,'changed-report.json'),/summary/);
 edit(value=>value.findings[0].tests.push('invented.test.mjs'));assert.throws(()=>readInvestigationReport(root,'changed-report.json'),/finding/);
});
test('workflow installation pins TestLore and trusted push events and cannot overwrite an existing workflow',async t=>{
 const {root}=await project(t);commit(root);const result=installInvestigationWorkflow(root,{actionRef:'c'.repeat(40)});assert.deepEqual(result,['.github/workflows/testlore-investigate.yml']);
 const text=fs.readFileSync(path.join(root,result[0]),'utf8');assert.match(text,/#cccccccc/);assert.match(text,/workflow_dispatch/);assert.match(text,/include-hidden-files: true/);assert.doesNotMatch(text,/pull_request|schedule:|contents: write/);
 assert.deepEqual(installInvestigationWorkflow(root,{actionRef:'d'.repeat(40)}),[]);assert.throws(()=>installInvestigationWorkflow(root,{actionRef:'main'}),/exact reviewed/);
});
test('CLI distinguishes read-only plan, actual finding, and invalid command permissions',async t=>{
 const {root}=await project(t),invoke=(...args)=>spawnSync(process.execPath,[cli,...args,'--root',root,'--json'],{encoding:'utf8'});
 assert.equal(invoke('investigate').status,0);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
 const run=invoke('investigate','--execute');assert.equal(run.status,1,run.stderr);assert.equal(JSON.parse(run.stdout).summary.reproduced,1);
 assert.equal(invoke('immunity').status,0);assert.equal(invoke('investigation-learn').status,0);
 assert.notEqual(invoke('investigate','--selective').status,0);assert.notEqual(invoke('investigation-outcome','--execute').status,0);
});
test('real MCP host exposes configured immunity inspection while startup execution policy controls investigation',async t=>{
 const {root}=await project(t),moduleUrl=new URL('../src/mcp.js',import.meta.url).href;
 const connect=async enabled=>{const transport=new StdioClientTransport({command:process.execPath,args:['--input-type=module','-e',`import {serveMcp} from ${JSON.stringify(moduleUrl)};await serveMcp(${JSON.stringify({root,allowExecution:enabled})});`],cwd:root,stderr:'pipe'});const client=new Client({name:'immunity-contract-test',version:'1'});await client.connect(transport);t.after(()=>client.close());return client;};
 const inspect=await connect(false),tools=(await inspect.listTools()).tools;assert.ok(tools.some(row=>row.name==='testlore_immunity'));assert.ok(!tools.some(row=>row.name==='testlore_investigate'));
 const status=await inspect.callTool({name:'testlore_immunity',arguments:{}});assert.equal(status.isError,undefined);assert.equal(fs.existsSync(path.join(root,'.tddswarm')),false);
 const enabled=await connect(true),finding=await enabled.callTool({name:'testlore_investigate',arguments:{}});assert.equal(finding.isError,undefined);assert.equal(finding.structuredContent.summary.reproduced,1);
 assert.equal((await enabled.callTool({name:'testlore_investigate',arguments:{root:'/tmp'}})).isError,true);
});
test('opted-in autopilot retains a green-suite observation without manufacturing a fix or invoking an unused provider',async t=>{
 const {root,manifest}=await project(t);manifest.targets[0].contracts=[];write(root,'tddswarm.probes.json',manifest);write(root,'tddswarm.requirements.md','ASCII results remain unchanged; Unicode counts use code points.');
 const worker=fixture(t,{'unused.mjs':"throw new Error('An unapproved probe must never invoke this provider');"});write(root,'tddswarm.config.json',{agent:[process.execPath,path.join(worker,'unused.mjs')],investigation:{enabled:true}});for(const file of fs.readdirSync(path.join(root,'qualification')))fs.chmodSync(path.join(root,'qualification',file),0o644);commit(root);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;const result=spawnSync(process.execPath,[cli,'autopilot','--local','--deadline-ms','20000','--root',root,'--json'],{env,encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr+result.stdout);
 const report=JSON.parse(result.stdout);assert.equal(report.status,'no-reproduced-bug');assert.equal(report.autopilotDetection.status,'no-failures');assert.equal(report.investigation.summary['not-applicable'],1);assert.ok(report.investigation.budget.totalMs<20000);assert.equal(report.published,false);assert.equal(report.merged,false);
});
