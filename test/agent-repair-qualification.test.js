import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './helpers.js';
import {createFixture, boundedProcess, safeHostEnvironment, hostEvents} from '../scripts/host-qualification.js';
import {repairFixture} from '../scripts/fixture-repair-mcp.js';
import {fixtureSnapshot, assessRepairDiff, parseIndependentRun, assessRepairLoop, parseRepairArguments, qualifyRepairHosts, repairSummarySchema, repairQualificationPrompt} from '../scripts/agent-repair-qualification.js';
import {execute} from '../src/execution.js';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {repairProfile,createMaintainerRepairFixture} from '../scripts/maintainer-repair-profile.js';
import {independentRun} from '../scripts/agent-repair-qualification.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const testFiles = ['test/fault.test.js', 'test/preserved.test.js'];
const fault = 'export const value=9;\n', fixed = 'export const value = 1;\n';

function config(root) {root = fs.realpathSync(root); const stat = fs.statSync(root); return {root, rootIdentity: {dev: stat.dev, ino: stat.ino}, expectedFaultSha256: hash(fault)};}
async function independent(root) {
  const result = await boundedProcess(process.execPath, ['--test', `--test-reporter=${path.resolve('src/reporters/node.js')}`, ...testFiles],
    {cwd: root, env: safeHostEnvironment(process.env), timeoutMs: 10000, maximumBytes: 65536});
  return parseIndependentRun(result, root);
}
function observerCalls(initial, final) {
  const entrypoint = {sha256: 'a'.repeat(64)}, node = {sha256: 'b'.repeat(64)};
  const call = (id, name, args, result, start) => ({id, name, arguments: args, result, requestedAt: start, respondedAt: start + 1});
  return {entrypoint, node, processResult: {status: 'completed', exitCode: 0}, observed: [
    {mode: 'readonly', entrypoint, node, tools: ['testlore_brief', 'testlore_status'], calls: [
      call(1, 'testlore_brief', {}, {authority: 'advisory', execution: {projectCommandsInvoked: false}}, 1),
      call(2, 'testlore_status', {}, {present: false, reason: 'no-retained-run', projectCommandsInvoked: false}, 3)]},
    {mode: 'execution', entrypoint, node, tools: ['testlore_brief', 'testlore_status', 'testlore_plan', 'testlore_verify'], calls: [
      call(1, 'testlore_plan', {base: 'HEAD'}, {complete: true, authority: 'routing-proposal'}, 5),
      call(2, 'testlore_verify', {base: 'HEAD', mode: 'shadow'}, initial, 7),
      call(3, 'testlore_plan', {base: 'HEAD'}, {complete: true, authority: 'routing-proposal'}, 11),
      call(4, 'testlore_verify', {base: 'HEAD', mode: 'full'}, final, 13)]}]};
}

test('bounded repair refuses arbitrary code, repeated edits, symlinks and fault drift', t => {
  const root = fixture(t); createFixture(root); const bound = config(root);
  for (const source of ['export const value=2;', 'export const value=1;process.exit(0);', 'x'.repeat(129), null]) assert.throws(() => repairFixture(bound, source), /authorized/);
  const before = fixtureSnapshot(root), result = repairFixture(bound, fixed);
  assert.equal(result.complete, true); assert.deepEqual(assessRepairDiff(before, fixtureSnapshot(root)), []);
  assert.throws(() => repairFixture(bound, fixed), /planted fault/);
  fs.unlinkSync(path.join(root, 'src/value.js')); fs.symlinkSync(path.join(root, 'src/preserved.js'), path.join(root, 'src/value.js'));
  assert.throws(() => repairFixture(bound, fixed)); assert.throws(() => fixtureSnapshot(root), /symlink/);
});

test('independent full execution preserves the actual fixed Node case identities across repair', async t => {
  const root = fixture(t); createFixture(root);
  fs.writeFileSync(path.join(root, 'src/value.js'), 'export const value=1;\n'); const baseline = await independent(root);
  fs.writeFileSync(path.join(root, 'src/value.js'), fault); const planted = await independent(root), before = fixtureSnapshot(root);
  const nativeInitial = execute(root, testFiles, {adapter: 'node'}, {capture: true});
  assert.equal(baseline.complete, true, JSON.stringify(baseline.errors)); assert.equal(planted.complete, true, JSON.stringify(planted.errors));
  assert.deepEqual(planted.cases.map(({id}) => id).sort(), nativeInitial.tests.map(({id}) => id).sort());
  const result = repairFixture(config(root), fixed), after = fixtureSnapshot(root), post = await independent(root);
  const initial = {complete: true, executed: true, mode: 'shadow', verdict: 'failed', outcomes: {passed: 1, failed: 1, skipped: 0},
    failedCases: planted.cases.filter(row => row.status === 'failed'), executedFiles: testFiles};
  const final = {complete: true, executed: true, mode: 'full', verdict: 'passed-in-observed-scope', outcomes: {passed: 2, failed: 0, skipped: 0}, executedFiles: testFiles};
  const input = {...observerCalls(initial, final), before, after, baseline, planted, independent: post,
    repair: {schemaVersion: 1, kind: 'bounded-fixture-repair', rejectedAdditionalCalls: 0, calls: [{requestedAt: 9, respondedAt: 10, sourceSha256: hash(fixed), result}]},
    finalMessage: JSON.stringify({verdict: 'passed-in-observed-scope', repairedFile: 'src/value.js', executedFiles: testFiles,
      uncertainty: 'This synthetic fixed contract does not establish deployment safety.', nextAction: 'Qualify real repair tasks with independent unchanged tests.', deploymentSafety: 'not-established'})};
  assert.equal(assessRepairLoop(input).qualified, true, JSON.stringify(assessRepairLoop(input).reasons));
  for (const mutate of [
    value => {value.after.find(row => row.file === 'test/fault.test.js').sha256 = 'c'.repeat(64);},
    value => {value.after.push({file: 'extra.js', sha256: 'c'.repeat(64)});},
    value => {value.independent.complete = false;},
    value => {value.independent.cases[0].status = 'failed';},
    value => {value.independent.cases[0].id = 'fabricated';},
    value => {value.repair.calls[0].result.complete = false;},
    value => {value.repair.rejectedAdditionalCalls = 1;},
    value => {value.observed[1].calls[3].id = value.observed[1].calls[1].id;},
    value => {value.repair.calls[0].requestedAt = 1;},
    value => {value.observed[1].calls.pop();},
    value => {value.observed[1].calls[3].result.complete = false;},
    value => {value.observed[1].calls[3].arguments.mode = 'shadow';},
    value => {value.processResult.status = 'timeout';},
    value => {value.finalMessage = '{"verdict":"passed-in-observed-scope"}';},
    value => {const summary = JSON.parse(value.finalMessage); summary.uncertainty = {global: 0, retainedTests: [], scopeLimitation: 'Observed test-file scope only.'}; value.finalMessage = JSON.stringify(summary);},
    value => {const summary = JSON.parse(value.finalMessage); summary.nextAction = {action: 'continue'}; value.finalMessage = JSON.stringify(summary);},
    value => {const summary = JSON.parse(value.finalMessage); summary.extraClaim = 'gold standard'; value.finalMessage = JSON.stringify(summary);}
  ]) {const altered = structuredClone(input); mutate(altered); assert.equal(assessRepairLoop(altered).qualified, false);}
  for (const mutate of [
    value => {value.stdout += '\nall passed';},
    value => {value.exitCode = 1;},
    value => {value.stdout = '';},
    value => {value.status = 'timeout';}
  ]) {const bad = structuredClone(post.process); mutate(bad); assert.equal(parseIndependentRun(bad, root).complete, false);}
});

test('native repair prompt declares the exact final account schema and actionable prose requirements', () => {
  const schema = repairSummarySchema(), prompt = repairQualificationPrompt();
  assert.equal(schema.properties.uncertainty.type, 'string'); assert.equal(schema.properties.nextAction.type, 'string');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
  assert.ok(prompt.includes(JSON.stringify(schema))); assert.match(prompt, /prose STRING of at least 20 characters/);
  assert.match(prompt, /do not copy the tool uncertainty object/); assert.match(prompt, /constant fixture cannot establish/);
});

test('real fixture-only MCP capability repairs source and records rejected duplicate edits', async t => {
  const directory = fixture(t), root = path.join(directory, 'fixture'); createFixture(root);
  const configuration = {...config(root), receipt: path.join(directory, 'repair.json')}, filename = path.join(directory, 'config.json');
  fs.writeFileSync(filename, JSON.stringify(configuration));
  const transport = new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/fixture-repair-mcp.js'), filename], cwd: root, stderr: 'pipe'});
  const client = new Client({name: 'repair-capability-test', version: '1.0.0'}); t.after(async () => {await client.close();}); await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(({name}) => name), ['repair_fixture']); assert.equal(tools[0].annotations.destructiveHint, true);
  assert.equal((await client.callTool({name: 'repair_fixture', arguments: {source: fixed}})).structuredContent.complete, true);
  assert.equal((await independent(root)).complete, true);
  assert.equal((await client.callTool({name: 'repair_fixture', arguments: {source: fixed}})).isError, true);
  const receipt = JSON.parse(fs.readFileSync(configuration.receipt, 'utf8'));
  assert.equal(receipt.calls.length, 1); assert.equal(receipt.rejectedAdditionalCalls, 1);
});

test('explicit repair opt-in never expands default detection host tools', async () => {
  const argv = ['--run', '--authorize-fixture-tools', '--entrypoint', '/package/src/cli.js', '--output', '/tmp/repair.json'];
  assert.throws(() => parseRepairArguments(argv), /authorize-fixture-repair/);
  assert.equal(parseRepairArguments([...argv, '--authorize-fixture-repair']).authorizeFixtureRepair, true);
  await assert.rejects(qualifyRepairHosts({authorizeFixtureRepair: true, authorizeFixtureTools: false}), /opt-ins/);
  const event = JSON.stringify({item: {type: 'mcp_tool_call', server: 'testlore_fixture', tool: 'repair_fixture'}});
  assert.equal(hostEvents('codex', event).errors.length, 1); assert.equal(hostEvents('codex', event, true).errors.length, 0);
  assert.equal(hostEvents('codex', JSON.stringify({item: {type: 'mcp_tool_call', server: 'testlore_fixture', tool: 'change_tests'}}), true).errors.length, 1);
});

test('named maintainer profile binds genuine historical bytes, unchanged assertion bodies and one repair target',()=>{
  const profile=repairProfile('maintainer-is-promise'),schema=repairSummarySchema(profile.name),prompt=repairQualificationPrompt(profile.name);
  assert.equal(profile.provenance.fixed,'ed0eaa4dec17597f0dae892a0472a9b7f459320d');assert.equal(profile.provenance.parent,'2dfb684306b6f3b8b374478c86e63f8bab4a7f06');assert.equal(profile.provenance.bindings.length,5);
  assert.equal(profile.count,8);assert.equal(profile.failedCount,2);assert.equal(profile.maxSourceBytes,1024);assert.deepEqual(schema.properties.repairedFile.enum,['src/promise.cjs']);assert.deepEqual(schema.properties.executedFiles.items.enum,['test/promise.test.cjs']);
  assert.ok(profile.oracle.endsWith(profile.original.slice(profile.original.indexOf('\n\n'))));assert.match(profile.license,/Forbes Lindesay/);assert.ok(prompt.includes(JSON.stringify(schema)));assert.ok(prompt.includes(JSON.stringify(profile.fault)));assert.match(prompt,/all seven calls/i);
  assert.throws(()=>repairProfile('arbitrary-edit'),/Unknown/);
});

test('contract-only maintainer task supplies contract and fault without leaking the fixed implementation or repair hint',t=>{
  const profile=repairProfile('maintainer-is-promise'),prompt=repairQualificationPrompt(profile.name,'contract-only');
  assert.ok(prompt.includes(JSON.stringify(profile.readme)));
  assert.ok(prompt.includes(JSON.stringify(profile.fault)));
  assert.ok(prompt.includes(JSON.stringify(repairSummarySchema(profile.name))));
  assert.ok(!prompt.includes(JSON.stringify(profile.fixed)));
  assert.doesNotMatch(prompt,/prefix the first obj|!!obj|boolean guard repair/);
  assert.match(prompt,/alternative equivalent edits can be rejected/);
  // Admission remains independent and closed even when the solution is withheld.
  const root=fixture(t);
  try{
    createMaintainerRepairFixture(root);const stat=fs.statSync(root);
    const bound={root:fs.realpathSync(root),rootIdentity:{dev:stat.dev,ino:stat.ino},expectedFaultSha256:hash(profile.fault),repairProfile:profile.name};
    assert.throws(()=>repairFixture(bound,profile.fault),/authorized/);
    assert.throws(()=>repairFixture(bound,profile.fixed+'process.exit(0);'),/authorized/);
    assert.equal(repairFixture(bound,profile.fixed).complete,true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
  const argv=['--run','--authorize-fixture-tools','--authorize-fixture-repair','--entrypoint','/package/src/cli.js','--output','/tmp/repair.json'];
  assert.equal(parseRepairArguments([...argv,'--repair-profile',profile.name,'--repair-instructions','contract-only']).repairInstructions,'contract-only');
  assert.equal(parseRepairArguments([...argv,'--repair-profile',profile.name]).repairInstructions,'supplied');
  assert.throws(()=>parseRepairArguments([...argv,'--repair-instructions','contract-only']),/maintainer/);
  assert.throws(()=>parseRepairArguments([...argv,'--repair-instructions','open-edit']),/Unknown/);
  assert.throws(()=>parseRepairArguments([...argv,'--repair-instructions','supplied','--repair-instructions','contract-only']),/Duplicate/);
  assert.throws(()=>repairQualificationPrompt('synthetic','contract-only'),/maintainer/);
});

test('maintainer repair refuses wrong source, extra code, target redirection, root drift and repeated edits',t=>{
  const root=fixture(t),profile=createMaintainerRepairFixture(root),stat=fs.statSync(root);
  const bound={root:fs.realpathSync(root),rootIdentity:{dev:stat.dev,ino:stat.ino},expectedFaultSha256:hash(profile.fault),repairProfile:profile.name,target:'test/promise.test.cjs'};
  const before=fixtureSnapshot(root);
  for(const source of [profile.fault,'module.exports=()=>false;',profile.fixed+'process.exit(0);','x'.repeat(1025)])assert.throws(()=>repairFixture(bound,source),/authorized/);
  assert.throws(()=>repairFixture({...bound,expectedFaultSha256:'0'.repeat(64)},profile.fixed),/binding changed/);
  assert.throws(()=>repairFixture({...bound,rootIdentity:{...bound.rootIdentity,ino:0}},profile.fixed),/root identity/);
  assert.deepEqual(fixtureSnapshot(root),before);
  const result=repairFixture(bound,profile.fixed);assert.equal(result.changedFile,profile.target);assert.deepEqual(assessRepairDiff(before,fixtureSnapshot(root),profile.name),[]);assert.throws(()=>repairFixture(bound,profile.fixed),/planted fault/);
});

test('genuine maintainer defect preserves all eight independent cases and rejects loop/oracle drift',async t=>{
  const root=fixture(t),profile=createMaintainerRepairFixture(root),nodeIdentity={realpath:process.execPath};
  fs.writeFileSync(path.join(root,profile.target),profile.fixed);const baseline=await independentRun(root,nodeIdentity,profile.name);
  fs.writeFileSync(path.join(root,profile.target),profile.fault);const planted=await independentRun(root,nodeIdentity,profile.name),before=fixtureSnapshot(root);
  assert.equal(baseline.complete,true,JSON.stringify(baseline.errors));assert.equal(planted.complete,true,JSON.stringify(planted.errors));assert.equal(baseline.cases.length,8);assert.equal(planted.cases.filter(row=>row.status==='failed').length,2);
  const nativeInitial=execute(root,profile.files,{adapter:'node'},{capture:true});assert.deepEqual(nativeInitial.tests.map(row=>row.id).sort(),planted.cases.map(row=>row.id).sort());
  const stat=fs.statSync(root),result=repairFixture({root:fs.realpathSync(root),rootIdentity:{dev:stat.dev,ino:stat.ino},expectedFaultSha256:hash(profile.fault),repairProfile:profile.name},profile.fixed),after=fixtureSnapshot(root),post=await independentRun(root,nodeIdentity,profile.name);
  const initial={complete:true,executed:true,mode:'shadow',verdict:'failed',outcomes:{passed:6,failed:2,skipped:0},failedCases:planted.cases.filter(row=>row.status==='failed'),executedFiles:profile.files};
  const final={complete:true,executed:true,mode:'full',verdict:'passed-in-observed-scope',outcomes:{passed:8,failed:0,skipped:0},executedFiles:profile.files};
  const input={...observerCalls(initial,final),profileName:profile.name,before,after,baseline,planted,independent:post,
    repair:{schemaVersion:1,kind:'bounded-fixture-repair',rejectedAdditionalCalls:0,calls:[{requestedAt:9,respondedAt:10,sourceSha256:hash(profile.fixed),result}]},
    finalMessage:JSON.stringify({verdict:'passed-in-observed-scope',repairedFile:profile.target,executedFiles:profile.files,uncertainty:'One adapted maintainer contract cannot establish full application or deployment safety.',nextAction:'Qualify additional independent historical repairs under unchanged maintainer assertions.',deploymentSafety:'not-established'})};
  assert.equal(assessRepairLoop(input).qualified,true,JSON.stringify(assessRepairLoop(input).reasons));
  for(const mutate of [
    value=>{value.before.find(row=>row.file===profile.files[0]).sha256='0'.repeat(64);},
    value=>{value.before.find(row=>row.file==='tddswarm.requirements.md').sha256='0'.repeat(64);},
    value=>{value.before.find(row=>row.file==='tddswarm.config.json').sha256='0'.repeat(64);},
    value=>{value.after.find(row=>row.file===profile.files[0]).sha256='0'.repeat(64);},
    value=>{value.after.find(row=>row.file==='README.maintainer.md').sha256='0'.repeat(64);},
    value=>{value.after.find(row=>row.file==='LICENSE.maintainer').sha256='0'.repeat(64);},
    value=>{value.after.find(row=>row.file==='tddswarm.config.json').sha256='0'.repeat(64);},
    value=>{value.after.find(row=>row.file===profile.target).sha256='0'.repeat(64);value.repair.calls[0].result.afterSha256='0'.repeat(64);value.repair.calls[0].sourceSha256='0'.repeat(64);},
    value=>{value.independent.cases[0].id='drifted';},
    value=>{value.independent.cases.pop();},
    value=>{for(const run of [value.baseline,value.planted,value.independent])run.cases.pop();},
    value=>{value.observed[1].calls[1].result.failedCases[0].id='fabricated';},
    value=>{value.observed[1].calls[1].result.failedCases={};},
    value=>{value.observed[1].calls[1].result.failedCases=[null];},
    value=>{value.observed[1].calls[1].result.outcomes.failed=1;},
    value=>{value.observed[1].calls[3].result.outcomes.passed=2;},
    value=>{value.observed[1].calls[3].arguments.mode='shadow';},
    value=>{value.observed[0].calls[0].respondedAt=99;},
    value=>{value.observed[0].tools.push('edit_tests');},
    value=>{value.observed[0].calls[0].arguments={unexpected:true};},
    value=>{value.observed[1].calls[0].isError=true;},
    value=>{value.repair.calls[0].requestedAt=1;},
    value=>{value.repair.calls[0].result.changedFile=profile.files[0];},
    value=>{value.processResult.status='timeout';},
    value=>{value.repair.rejectedAdditionalCalls=1;},
    value=>{const summary=JSON.parse(value.finalMessage);summary.repairedFile='src/value.js';value.finalMessage=JSON.stringify(summary);}
  ]){const mutated=structuredClone(input);mutate(mutated);assert.equal(assessRepairLoop(mutated).qualified,false);}
  const wrongNames=structuredClone(post.process);wrongNames.stdout=wrongNames.stdout.replaceAll('with null','with another input');assert.equal(parseIndependentRun(wrongNames,root,profile.name).complete,false);
});

test('real maintainer MCP accepts one canonical source edit while assertions and provenance remain sealed',async t=>{
  const directory=fixture(t),root=path.join(directory,'fixture'),profile=createMaintainerRepairFixture(root),stat=fs.statSync(root),before=fixtureSnapshot(root);
  const configuration={root:fs.realpathSync(root),rootIdentity:{dev:stat.dev,ino:stat.ino},expectedFaultSha256:hash(profile.fault),repairProfile:profile.name,receipt:path.join(directory,'repair.json')},filename=path.join(directory,'config.json');fs.writeFileSync(filename,JSON.stringify(configuration));
  const client=new Client({name:'maintainer-capability-test',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('scripts/fixture-repair-mcp.js'),filename],cwd:root,stderr:'pipe'});t.after(async()=>client.close());await client.connect(transport);
  const tools=(await client.listTools()).tools;assert.deepEqual(tools.map(row=>row.name),['repair_fixture']);assert.deepEqual(Object.keys(tools[0].inputSchema.properties),['source']);assert.equal(tools[0].inputSchema.properties.source.maxLength,1024);
  assert.equal((await client.callTool({name:'repair_fixture',arguments:{source:profile.fixed}})).structuredContent.complete,true);assert.deepEqual(assessRepairDiff(before,fixtureSnapshot(root),profile.name),[]);
  const native=await independentRun(root,{realpath:process.execPath},profile.name);assert.equal(native.complete,true);assert.equal(native.cases.filter(row=>row.status==='passed').length,8);
  assert.equal((await client.callTool({name:'repair_fixture',arguments:{source:profile.fixed}})).isError,true);
});

test('named profile is explicit, preserves synthetic default and prohibits a second prospective host call',async()=>{
  const argv=['--run','--authorize-fixture-tools','--authorize-fixture-repair','--entrypoint','/package/src/cli.js','--output','/tmp/repair.json'];
  assert.equal(parseRepairArguments(argv).repairProfile,'synthetic');assert.equal(parseRepairArguments([...argv,'--repair-profile','maintainer-is-promise']).repairProfile,'maintainer-is-promise');
  assert.throws(()=>parseRepairArguments([...argv,'--repair-profile','all-files']),/Unknown/);assert.throws(()=>parseRepairArguments([...argv,'--repair-profile','synthetic','--repair-profile','synthetic']),/Duplicate/);
  await assert.rejects(qualifyRepairHosts({authorizeFixtureRepair:true,authorizeFixtureTools:true,repairProfile:'maintainer-is-promise',timeoutMs:1000,claude:'/host/claude'}),/at most one/);
});
