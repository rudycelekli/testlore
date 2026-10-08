#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createFixture, executableIdentity, hostIdentityFor, executableDrift, packageSnapshot, assertCanonicalEntrypoint,
  boundedProcess, safeHostEnvironment, hostEvents, readBoundedText, readObserverReceipt, fixtureToolApprovalArguments,
  parseHostArguments, assessHost} from './host-qualification.js';
import {repairProfile,authorizedRepairSource,createMaintainerRepairFixture,maintainerFixtureContents} from './maintainer-repair-profile.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const relativeScript = name => fileURLToPath(new URL(name, import.meta.url));
const caseTuples = rows => Array.isArray(rows) && rows.every(row => row && typeof row.id==='string' && typeof row.file==='string' && typeof row.name==='string')
  ? JSON.stringify(rows.map(({id,file,name})=>[id,file,name]).sort()) : null;

export function repairSummarySchema(profileName='synthetic') {
  const profile=repairProfile(profileName);
  return {type: 'object', additionalProperties: false,
    required: ['verdict', 'repairedFile', 'executedFiles', 'uncertainty', 'nextAction', 'deploymentSafety'],
    properties: {
      verdict: {type: 'string', enum: ['failed', 'incomplete', 'passed-in-observed-scope']},
      repairedFile: {type: 'string', enum: [profile.target]},
      executedFiles: {type: 'array', items: {type: 'string', enum: [...profile.files]}},
      uncertainty: {type: 'string', description: 'At least 20 characters of prose explaining the limits of this scoped observation; do not copy the structured tool uncertainty object.'},
      nextAction: {type: 'string', description: 'At least 20 characters of prose describing a concrete next verification or qualification action.'},
      deploymentSafety: {type: 'string', enum: ['not-established']}
    }};
}

export function repairQualificationPrompt(profileName='synthetic',instructions='supplied') {
  if(!['supplied','contract-only'].includes(instructions))throw new Error('Unknown repair instructions mode');
  if(instructions==='contract-only'&&profileName!=='maintainer-is-promise')throw new Error('Contract-only instructions require the maintainer profile');
  const profile=repairProfile(profileName);
  if(instructions==='contract-only')return 'This is an isolated genuine historical then/is-promise maintainer-contract repair qualification. Use ONLY configured TestLore MCP tools. No shell, file, web, or other tools. Call readonly testlore_brief then testlore_status; execution testlore_plan({base:"HEAD"}) then testlore_verify({base:"HEAD",mode:"shadow"}); inspect the independently observed failures. Infer the smallest source correction from the supplied maintainer API contract and faulty source. No repair implementation or historical fixed source is supplied. Call fixture repair_fixture exactly once, supplying the full src/promise.cjs source. Preserve all bytes outside the necessary source correction. Do not alter tests, requirements, README, license or configuration. Maintainer API contract: '+JSON.stringify(profile.readme)+'. Faulty source: '+JSON.stringify(profile.fault)+'. Then execution testlore_plan({base:"HEAD"}) and testlore_verify({base:"HEAD",mode:"full"}). All seven calls must be sequential, exactly once, stop on error. Return only one JSON object satisfying this schema: '+JSON.stringify(repairSummarySchema(profileName))+'. uncertainty and nextAction MUST each be a prose STRING of at least 20 characters. executedFiles must contain exactly the observed test file with no duplicates. This capability admits only one independently frozen canonical correction; alternative equivalent edits can be rejected. Original maintainer assertion bodies are unchanged on Node import shims. Do not claim a complete upstream Mocha environment, broad autonomous application repair or deployment safety. Report actual observed outcomes only.';
  if(profileName==='maintainer-is-promise')return 'This is an isolated genuine historical then/is-promise maintainer-contract repair qualification. Use ONLY configured TestLore MCP tools. No shell, file, web, or other tools. Call readonly testlore_brief then testlore_status; execution testlore_plan({base:"HEAD"}) then testlore_verify({base:"HEAD",mode:"shadow"}); observe the historical null/undefined failures. Call fixture repair_fixture exactly once, supplying the full src/promise.cjs source. Preserve every existing byte except the necessary boolean guard repair: prefix the first obj in the return expression with !!. Do not alter tests, requirements, README, license or configuration. The historical source to repair is '+JSON.stringify(profile.fault)+'. Then execution testlore_plan({base:"HEAD"}) and testlore_verify({base:"HEAD",mode:"full"}). All seven calls must be sequential, exactly once, stop on error. Return only one JSON object satisfying this schema: '+JSON.stringify(repairSummarySchema(profileName))+'. uncertainty and nextAction MUST each be a prose STRING of at least 20 characters. executedFiles must contain exactly the observed test file with no duplicates. The original maintainer assertions are unchanged; imports adapt them to Node. Do not claim a complete upstream Mocha environment, broad repair quality or deployment safety. Report actual observed outcomes only.';
  return 'This is a disposable synthetic repair qualification. Use ONLY configured TestLore MCP tools. No shell, file, web, or other tools. Call readonly testlore_brief then testlore_status; execution testlore_plan({base:"HEAD"}) then testlore_verify({base:"HEAD",mode:"shadow"}); observe the planted failure. Call fixture repair_fixture exactly once with source implementing export const value equal to the independent expected 1, preserving all tests and other files. Then execution testlore_plan({base:"HEAD"}) and testlore_verify({base:"HEAD",mode:"full"}). All seven calls must be sequential, exactly once, stop on error. Return only one JSON object satisfying this final-account schema: '
    + JSON.stringify(repairSummarySchema())
    + '. uncertainty and nextAction MUST each be a prose STRING of at least 20 characters. Summarize observed uncertainty in prose; do not copy the tool uncertainty object. executedFiles must contain exactly the two observed test file paths, with no duplicates. verdict must match the final actual tool outcome. Do not add keys. Report observed results only; the constant fixture cannot establish deployment safety or general repair quality.';
}

export function fixtureSnapshot(root) {
  const inventory = [];
  const walk = directory => {
    for (const item of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, item.name), file = path.relative(root, filename).split(path.sep).join('/');
      if (file === '.git' || file === '.tddswarm') continue;
      if (item.isSymbolicLink()) throw new Error('Fixture symlink is forbidden');
      if (item.isDirectory()) walk(filename);
      else if (item.isFile()) inventory.push({file, sha256: hash(readBoundedText(filename, 16384))});
      else throw new Error('Unexpected fixture filesystem entry');
      if (inventory.length > 32) throw new Error('Fixture inventory exceeded');
    }
  };
  walk(root); return inventory;
}

export function assessRepairDiff(before, after,profileName='synthetic') {
  const profile=repairProfile(profileName);
  const reasons = [], expected = new Map(before.map(row => [row.file, row.sha256])), actual = new Map(after.map(row => [row.file, row.sha256]));
  for (const [file, sha] of expected) if (file !== profile.target && actual.get(file) !== sha) reasons.push(`protected-fixture-file-changed:${file}`);
  for (const file of actual.keys()) if (!expected.has(file)) reasons.push(`unexpected-fixture-file:${file}`);
  if (!actual.has(profile.target) || actual.get(profile.target) === expected.get(profile.target)) reasons.push('source-repair-not-observed');
  return reasons;
}

// Parse independently launched Node reporter events, without calling TestLore's
// planner, run API or retained receipts. Fixed independent test source is sealed.
export function parseIndependentRun(result, root,profileName='synthetic') {
  const profile=repairProfile(profileName);
  root = fs.realpathSync(root);
  const cases = [], errors = [],events=[],parents=new Map(),names=new Map(); let terminal;
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    if (!line.startsWith('@tddswarm:')) {errors.push('unexpected-native-output'); continue;}
    let event; try {event = JSON.parse(line.slice(10));} catch {errors.push('malformed-native-event'); continue;}
    if (!event || typeof event !== 'object' || Array.isArray(event) || !event.data || typeof event.data !== 'object') {errors.push('malformed-native-event'); continue;}
    events.push(event);
  }
  // Independently reconstruct the native terminal tree; never consume planner
  // identities or retained TestLore receipts to define the maintainer oracle.
  for(let index=events.length-1;index>=0;index--){
    const event=events[index],data=event.data;if(!['test:pass','test:fail'].includes(event.type)||!data.file)continue;
    const file=path.relative(root,data.file).split(path.sep).join('/'),nesting=data.nesting??0;
    if(!Number.isInteger(nesting)||nesting<0||nesting>128||typeof data.name!=='string'){errors.push('invalid-native-ancestry');continue;}
    const ancestry=parents.get(file)||[];ancestry[nesting]=data.name;ancestry.length=nesting+1;parents.set(file,ancestry);
    if(Array.from({length:nesting},(_,i)=>ancestry[i]).some(name=>typeof name!=='string')){errors.push('incomplete-native-ancestry');continue;}
    names.set(event,ancestry.join(' > '));
  }
  for(const event of events){
    const data=event.data;
    if (event.type === 'test:summary' && !data.file) {if (terminal) errors.push('duplicate-native-summary'); terminal = data;}
    if (!['test:pass', 'test:fail'].includes(event.type) || !data.file || data.details?.type === 'suite') continue;
    const file = path.relative(root, data.file).split(path.sep).join('/');
    const name=names.get(event)||data.name;
    if (!profile.files.includes(file) || !profile.caseNames.includes(name)) {errors.push('unexpected-native-case'); continue;}
    const id = hash(`${file}\0${name}\0${data.line || ''}\0${data.column || ''}` + '\0' + 0);
    cases.push({file, name, id, status: data.skip || data.todo ? 'skipped' : event.type === 'test:pass' ? 'passed' : 'failed'});
  }
  if (result.status !== 'completed' || ![0, 1].includes(result.exitCode) || result.stderr) errors.push('native-process-incomplete');
  if (cases.length !== profile.count || new Set(cases.map(row => row.id)).size !== profile.count || new Set(cases.map(row => row.file)).size !== profile.files.length||JSON.stringify(cases.map(row=>row.name).sort())!==JSON.stringify(profile.caseNames.slice().sort())) errors.push('independent-case-inventory-incomplete');
  const passed = cases.filter(row => row.status === 'passed').length, failed = cases.filter(row => row.status === 'failed').length;
  if (!terminal || terminal.counts?.tests !== profile.count || terminal.counts?.passed !== passed || terminal.counts?.failed !== failed
    || terminal.counts?.skipped !== 0 || terminal.counts?.todo !== 0 || terminal.counts?.cancelled !== 0 || terminal.success !== (failed === 0)
    || result.exitCode !== (failed ? 1 : 0)) errors.push('independent-terminal-outcomes-mismatch');
  return {complete: errors.length === 0, cases, errors, process: result};
}

export async function independentRun(root, node,profileName='synthetic') {
  const profile=repairProfile(profileName);
  const process = await boundedProcess(node.realpath, ['--test', `--test-reporter=${relativeScript('../src/reporters/node.js')}`, ...profile.files],
    {cwd: root, env: safeHostEnvironment(globalThis.process.env), timeoutMs: 10000, maximumBytes: 65536});
  return parseIndependentRun(process, root,profileName);
}

// Same bounded initial lifecycle as the synthetic gate, but bound to the actual
// unchanged maintainer inventory and independently observed historical failures.
function assessMaintainerInitial({processResult,observed,entrypoint,nodeIdentity},planted,profile){
  const reasons=[];
  if(processResult.status!=='completed'||processResult.exitCode!==0)reasons.push(`host-${processResult.status}:${processResult.reason||processResult.exitCode}`);
  const readonly=observed.find(row=>row.mode==='readonly'),execution=observed.find(row=>row.mode==='execution');
  for(const [mode,receipt,tools]of [['readonly',readonly,['testlore_brief','testlore_status']],['execution',execution,['testlore_brief','testlore_status','testlore_plan','testlore_verify']]]){
    if(!receipt){reasons.push(`${mode}-server-not-started`);continue;}
    if(receipt.entrypoint?.sha256!==entrypoint.sha256)reasons.push(`${mode}-entrypoint-mismatch`);
    if(receipt.node?.sha256!==nodeIdentity.sha256)reasons.push(`${mode}-node-identity-mismatch`);
    if(receipt.incomplete)reasons.push(`${mode}-observer-incomplete`);
    if(JSON.stringify([...(receipt.tools||[])].sort())!==JSON.stringify(tools.slice().sort()))reasons.push(`${mode}-tool-surface-mismatch`);
    const ids=new Set();
    for(const call of receipt.calls||[]){
      if(!(typeof call.id==='string'&&call.id.length>0||Number.isSafeInteger(call.id))||ids.has(call.id))reasons.push(`${mode}-ambiguous-request-id`);ids.add(call.id);
      if(!Number.isFinite(call.requestedAt)||!Number.isFinite(call.respondedAt)||call.respondedAt<call.requestedAt)reasons.push(`${mode}-invalid-observer-timestamps`);
      if(call.isError||!call.result)reasons.push(`${mode}-tool-response-incomplete`);
    }
  }
  if(JSON.stringify((readonly?.calls||[]).map(row=>row.name))!==JSON.stringify(['testlore_brief','testlore_status']))reasons.push('default-tool-call-sequence-mismatch');
  if(JSON.stringify((execution?.calls||[]).map(row=>row.name))!==JSON.stringify(['testlore_plan','testlore_verify']))reasons.push('execution-tool-call-sequence-mismatch');
  const brief=readonly?.calls?.[0],status=readonly?.calls?.[1],plan=execution?.calls?.[0],verify=execution?.calls?.[1];
  const exact=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(Object.keys(expected).sort())&&Object.keys(expected).every(key=>value[key]===expected[key]);
  if(!exact(brief?.arguments,{})||!exact(status?.arguments,{}))reasons.push('readonly-arguments-mismatch');
  if(!exact(plan?.arguments,{base:'HEAD'}))reasons.push('plan-arguments-mismatch');
  if(!exact(verify?.arguments,{base:'HEAD',mode:'shadow'}))reasons.push('verify-arguments-mismatch');
  if(readonly?.calls?.some(call=>call.respondedAt>plan?.requestedAt))reasons.push('execution-preceded-default-responses');
  if(brief?.respondedAt>status?.requestedAt||plan?.respondedAt>verify?.requestedAt)reasons.push('initial-stage-order-unverified');
  if(brief?.result?.execution?.projectCommandsInvoked!==false||brief?.result?.authority!=='advisory')reasons.push('default-brief-not-observed');
  if(status?.result?.projectCommandsInvoked!==false||status?.result?.present!==false||status?.result?.reason!=='no-retained-run')reasons.push('initial-status-not-observed');
  if(plan?.result?.complete!==true||plan?.result?.authority!=='routing-proposal')reasons.push('native-plan-not-complete');
  const result=verify?.result;
  if(result?.complete!==true||result?.executed!==true||result?.mode!=='shadow'||result?.verdict!=='failed'||result?.outcomes?.failed!==profile.failedCount||result?.outcomes?.passed!==profile.count-profile.failedCount||result?.outcomes?.skipped!==0||!Array.isArray(result.failedCases)||result.failedCases.length!==profile.failedCount)reasons.push('historical-failure-not-observed');
  if(JSON.stringify([...(result?.executedFiles||[])].sort())!==JSON.stringify(profile.files))reasons.push('full-shadow-scope-not-observed');
  const actualFailures=caseTuples(result?.failedCases),independentFailures=caseTuples(planted?.cases?.filter(row=>row.status==='failed'));
  if(actualFailures===null||actualFailures!==independentFailures)reasons.push('historical-failure-independent-identity-mismatch');
  return {qualified:!reasons.length,reasons};
}

function maintainerSeal(before,profile){
  const expected=Object.entries({...maintainerFixtureContents(profile),[profile.target]:profile.fault}).map(([file,content])=>({file,sha256:hash(content)})).sort((a,b)=>a.file.localeCompare(b.file));
  return JSON.stringify(before)===JSON.stringify(expected);
}

export function assessRepairLoop({processResult, observed, repair, before, after, baseline, planted, independent, finalMessage, entrypoint, node, hostErrors = [],profileName='synthetic'}) {
  const profile=repairProfile(profileName),files=profile.files;
  const reasons = [...hostErrors, ...assessRepairDiff(before, after,profileName)];
  if(profileName==='maintainer-is-promise'&&!maintainerSeal(before,profile))reasons.push('independent-maintainer-fixture-seal-mismatch');
  if(profileName==='maintainer-is-promise'&&after.find(row=>row.file===profile.target)?.sha256!==hash(profile.fixed))reasons.push('independent-source-semantics-rejected');
  const execution = observed.find(row => row.mode === 'execution'), calls = execution?.calls || [];
  const readonly = observed.find(row => row.mode === 'readonly');
  if (JSON.stringify(calls.map(row => row.name)) !== JSON.stringify(['testlore_plan', 'testlore_verify', 'testlore_plan', 'testlore_verify'])) reasons.push('repair-tool-sequence-mismatch');
  // Existing strict detection assessment remains an independent first-stage gate.
  const firstFailure = calls[1]?.result;
  const firstMessage = JSON.stringify({verdict: 'failed', failedCases: firstFailure?.failedCases, executedFiles: firstFailure?.executedFiles,
    uncertainty: 'Fixture observations cannot establish deployment safety.', nextAction: 'Repair the independent value contract and perform a fresh full verification.', deploymentSafety: 'not-established'});
  const initialInput={processResult, observed: [readonly, execution && {...execution, calls: calls.slice(0, 2)}].filter(Boolean),finalMessage: firstMessage,entrypoint,nodeIdentity:node};
  const initial = profileName==='synthetic'?assessHost(initialInput):assessMaintainerInitial(initialInput,planted,profile);
  reasons.push(...initial.reasons.map(reason => `initial:${reason}`));
  const repairCall = repair?.calls?.[0], final = calls[3];
  if (repair?.schemaVersion !== 1 || repair.kind !== 'bounded-fixture-repair' || repair.rejectedAdditionalCalls !== 0 || repair.calls?.length !== 1 || repairCall?.result?.complete !== true
    || repairCall.result.authority !== 'fixture-source-edit-only' || repairCall.result.changedFile !== profile.target
    || repairCall.sourceSha256 !== repairCall.result.afterSha256 || repairCall.result.beforeSha256 !== hash(profile.fault) || repairCall.result.afterSha256 !== after.find(row => row.file === profile.target)?.sha256)
    reasons.push('repair-receipt-incomplete-or-mismatched');
  const sequence = [calls[1], repairCall, calls[2], final];
  if (new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => !(typeof call.id === 'string' && call.id.length > 0 || Number.isSafeInteger(call.id)))) reasons.push('execution-ambiguous-request-id');
  for (let index = 0; index < sequence.length; index++) {
    const call = sequence[index];
    if (!Number.isFinite(call?.requestedAt) || !Number.isFinite(call?.respondedAt) || call.respondedAt < call.requestedAt
      || index > 0 && call.requestedAt < sequence[index - 1]?.respondedAt) reasons.push('repair-stage-order-unverified');
  }
  if (JSON.stringify(calls[2]?.arguments) !== JSON.stringify({base: 'HEAD'}) || calls[2]?.result?.complete !== true || calls[2]?.result?.authority !== 'routing-proposal'
    || !final?.arguments || Object.keys(final.arguments).length !== 2 || final.arguments.base !== 'HEAD' || final.arguments.mode !== 'full'
    || final.isError || final.result?.complete !== true || final.result?.executed !== true || final.result?.mode !== 'full'
    || final.result?.verdict !== 'passed-in-observed-scope' || final.result?.outcomes?.passed !== profile.count || final.result?.outcomes?.failed !== 0
    || final.result?.outcomes?.skipped !== 0 || JSON.stringify([...(final.result?.executedFiles || [])].sort()) !== JSON.stringify(files)) reasons.push('fresh-host-full-verification-incomplete');
  const validInventory = run => run?.complete===true && caseTuples(run.cases)!==null && run.cases.length===profile.count
    && new Set(run.cases.map(row=>row.id)).size===profile.count && JSON.stringify(run.cases.map(row=>row.name).sort())===JSON.stringify(profile.caseNames.slice().sort())
    && run.cases.every(row=>files.includes(row.file)&&['passed','failed'].includes(row.status));
  const identities = run => caseTuples(run?.cases);
  if (![baseline, planted, independent].every(validInventory) || baseline.cases.some(row => row.status !== 'passed')
    || planted.cases.filter(row => row.status === 'failed').length !== profile.failedCount || independent.cases.some(row => row.status !== 'passed')
    || identities(baseline) !== identities(planted) || identities(baseline) !== identities(independent)) reasons.push('independent-full-oracle-not-preserved');
  const firstFailedCases=caseTuples(firstFailure?.failedCases),plantedFailedCases=caseTuples(Array.isArray(planted?.cases)?planted.cases.filter(row=>row?.status==='failed'):null);
  if (firstFailedCases===null||firstFailedCases!==plantedFailedCases) reasons.push('initial-failure-independent-identity-mismatch');
  let summary; try {summary = JSON.parse(finalMessage.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim());} catch {}
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)
    || JSON.stringify(Object.keys(summary).sort()) !== JSON.stringify(repairSummarySchema(profileName).required.slice().sort())
    || summary.verdict !== 'passed-in-observed-scope' || summary.deploymentSafety !== 'not-established' || summary.repairedFile !== profile.target
    || JSON.stringify([...(Array.isArray(summary.executedFiles) ? summary.executedFiles : [])].sort()) !== JSON.stringify(files)
    || typeof summary.uncertainty !== 'string' || summary.uncertainty.length < 20 || typeof summary.nextAction !== 'string' || summary.nextAction.length < 20) reasons.push('host-final-repair-account-invalid');
  return {qualified: reasons.length === 0, status: reasons.length ? 'not-qualified' : profileName==='synthetic'?'qualified-in-fixture-scope':'qualified-in-maintainer-contract-scope', reasons, summary: summary || null,
    limitation: profile.limitation};
}

export function repairHostSelection(options,profileName='synthetic') {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('Repair host options must be an object');
  if(!['synthetic','maintainer-is-promise'].includes(profileName))throw new Error('Unknown named repair qualification profile');
  const selected=[];
  for(const host of ['codex','claude']){
    if(!Object.hasOwn(options,host)||options[host]===undefined)continue;
    const executable=options[host];
    if(typeof executable!=='string'||!executable.length||executable.includes('\0')||!path.isAbsolute(executable))throw new Error('Explicit absolute repair host executable required');
    selected.push(host);
  }
  if(profileName==='maintainer-is-promise'&&selected.length>1)throw new Error('The prospective maintainer profile permits at most one explicitly supplied native host: Codex OR Claude');
  return selected;
}

export async function qualifyRepairHosts(options) {
  if (options.authorizeFixtureRepair !== true || options.authorizeFixtureTools !== true) throw new Error('Explicit fixture repair and execution tool opt-ins are required');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error('Host deadline must be 1000..120000ms');
  const profileName=options.repairProfile??'synthetic',profile=repairProfile(profileName);
  const instructions=options.repairInstructions??'supplied';
  const qualificationPrompt=repairQualificationPrompt(profileName,instructions);
  const selectedHosts=repairHostSelection(options,profileName);
  const entrypoint = executableIdentity(options.entrypoint), node = executableIdentity(process.execPath), snapshot = packageSnapshot(options.entrypoint);
  assertCanonicalEntrypoint(entrypoint, snapshot);
  const metadata = JSON.parse(readBoundedText(path.join(snapshot.root, 'package.json'), 128 * 1024));
  if (metadata.name !== 'testlore' || metadata.bin?.testlore !== 'src/cli.js') throw new Error('Explicit TestLore package entrypoint required');
  if (options.expectedSha256 && entrypoint.sha256 !== options.expectedSha256) throw new Error('Entrypoint identity mismatch');
  if (options.archive || options.expectedSourceSha || options.expectedArchiveSha256) throw new Error('Repair controller binds source identities; archive certification belongs to the existing host controller');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-agent-repair-'));
  const harness = ['agent-repair-qualification.js', 'fixture-repair-mcp.js','maintainer-repair-profile.js', 'host-qualification.js', 'host-mcp-observer.js', '../src/reporters/node.js'].map(name => executableIdentity(relativeScript(name)));
  const report = {schemaVersion: 1, kind: 'native-agent-repair-qualification', startedAt: new Date().toISOString(), workspace, entrypoint, node, source: snapshot, harness,
    repairProfile:profileName,repairInstructions:instructions,solutionSupplied:instructions==='supplied',promptSha256:hash(qualificationPrompt),maintainerProvenance:profile.provenance||null,
    limitation:profile.limitation+(instructions==='contract-only'?' Repair inferred from README, faulty source and observed failures without an explicit implementation hint. A canonical admission gate still restricts edits; this is not open-ended autonomous repair.':''),
    finalAccountSchema: repairSummarySchema(profileName), finalAccountSchemaSha256: hash(JSON.stringify(repairSummarySchema(profileName))),
    maximumHostCalls: profileName==='synthetic'?2:1, retries: 0, timeoutMs: options.timeoutMs, providerApiKeysRemoved: true, hosts: []};
  for (const host of ['codex', 'claude']) {
    if (!selectedHosts.includes(host)) {report.hosts.push({host, qualified: false, status: 'not-started', reasons: ['explicit-host-executable-not-supplied']}); continue;}
    let identity;
    try {identity = hostIdentityFor(options[host], host);} catch (error) {report.hosts.push({host, qualified: false, status: 'not-started', reasons: [error.code || error.message]}); continue;}
    const directory = path.join(workspace, host);
    let root = path.join(directory, 'fixture');
    if(profileName==='synthetic')createFixture(root);else createMaintainerRepairFixture(root);
    root = fs.realpathSync(root); fs.writeFileSync(path.join(root, profile.target), profile.fixed);
    const baseline = await independentRun(root, node,profileName); fs.writeFileSync(path.join(root, profile.target), profile.fault);
    const planted = await independentRun(root, node,profileName), before = fixtureSnapshot(root), finalPath = path.join(directory, 'final.json');
    fs.writeFileSync(path.join(directory, 'commitment.json'), JSON.stringify({before, baseline, planted}), {mode: 0o600});
    if (!baseline.complete || !planted.complete||baseline.cases.some(row=>row.status!=='passed')||planted.cases.filter(row=>row.status==='failed').length!==profile.failedCount||JSON.stringify(baseline.cases.map(row=>row.id).sort())!==JSON.stringify(planted.cases.map(row=>row.id).sort())||profileName==='maintainer-is-promise'&&!maintainerSeal(before,profile)) {report.hosts.push({host, qualified: false, status: 'not-started', reasons: ['independent-fixture-prerequisite-failed'], baseline, planted}); continue;}
    const help = await boundedProcess(options[host], host === 'codex' ? ['exec', '--help'] : ['--help'], {cwd: root, env: safeHostEnvironment(process.env), timeoutMs: 10000});
    const requiredFlags = host === 'codex' ? ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-last-message', '--output-schema', '--json']
      : ['--setting-sources', '--strict-mcp-config', '--tools', '--allowedTools', '--disable-slash-commands', '--no-session-persistence', '--output-format', '--verbose'];
    if (help.status !== 'completed' || help.exitCode !== 0 || requiredFlags.some(flag => !help.stdout.includes(flag))) {
      report.hosts.push({host, qualified: false, status: 'not-started', reasons: ['installed-host-help-does-not-support-isolated-invocation'], help}); continue;
    }
    const servers = {}, configurations = [];
    for (const mode of ['readonly', 'execution']) {
      const config = {mode, root, node: node.realpath, entrypoint: entrypoint.realpath, receipt: path.join(directory, `${mode}-mcp.json`)};
      const filename = path.join(directory, `${mode}-observer.json`); fs.writeFileSync(filename, JSON.stringify(config), {mode: 0o600}); configurations.push(config);
      servers[`testlore_${mode}`] = {command: node.realpath, args: [relativeScript('host-mcp-observer.js'), filename]};
    }
    const rootIdentity = fs.statSync(root), repairConfig = {root,repairProfile:profileName, rootIdentity: {dev: rootIdentity.dev, ino: rootIdentity.ino}, expectedFaultSha256: hash(profile.fault), receipt: path.join(directory, 'repair.json')};
    const repairPath = path.join(directory, 'repair-config.json'); fs.writeFileSync(repairPath, JSON.stringify(repairConfig), {mode: 0o600});
    servers.testlore_fixture = {command: node.realpath, args: [relativeScript('fixture-repair-mcp.js'), repairPath]};
    const prompt = qualificationPrompt, schemaPath = path.join(directory, 'final-account-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(repairSummarySchema(profileName)), {mode: 0o600});
    const schemaIdentity = executableIdentity(schemaPath);
    let args;
    if (host === 'codex') {
      args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'read-only', '--json', '--output-last-message', finalPath, '--output-schema', schemaPath,
        '-c', 'approval_policy="never"', '-c', 'skills.max_context_tokens=10000'];
      for (const [server, config] of Object.entries(servers)) for (const [key, value] of Object.entries(config)) args.push('-c', `mcp_servers.${server}.${key}=${JSON.stringify(value)}`);
      args.push(...fixtureToolApprovalArguments(true), '-c', 'mcp_servers.testlore_fixture.tools.repair_fixture.approval_mode="approve"', prompt);
    } else {
      const mcpPath = path.join(directory, 'mcp.json'), settingsPath = path.join(directory, 'settings.json');
      fs.writeFileSync(mcpPath, JSON.stringify({mcpServers: servers}), {mode: 0o600}); fs.writeFileSync(settingsPath, JSON.stringify({disableAllHooks: true}), {mode: 0o600});
      args = ['--print', '--setting-sources', '', '--settings', settingsPath, '--strict-mcp-config', '--mcp-config', mcpPath, '--tools', '', '--allowedTools',
        'mcp__testlore_readonly__testlore_brief,mcp__testlore_readonly__testlore_status,mcp__testlore_execution__testlore_plan,mcp__testlore_execution__testlore_verify,mcp__testlore_fixture__repair_fixture',
        '--disable-slash-commands', '--no-session-persistence', '--verbose', '--output-format', 'stream-json', prompt];
    }
    const processResult = await boundedProcess(options[host], args, {cwd: root, env: safeHostEnvironment(process.env), timeoutMs: options.timeoutMs, stopOnNativeRetry: true});
    // Preserve complete bounded raw events before parsing or qualification.
    fs.writeFileSync(path.join(directory, 'host.stdout.jsonl'), processResult.stdout, {mode: 0o600}); fs.writeFileSync(path.join(directory, 'host.stderr'), processResult.stderr, {mode: 0o600});
    const events = hostEvents(host, processResult.stdout, true), observed = [], errors = [...events.errors]; let repair = null, finalMessage = events.finalMessage;
    for (const config of configurations) try {observed.push(readObserverReceipt(config.receipt, config.mode));} catch (error) {errors.push(`observer-rejected:${config.mode}:${error.code || error.message}`);}
    try {repair = JSON.parse(readBoundedText(repairConfig.receipt, 16384));} catch (error) {errors.push(`repair-receipt-rejected:${error.code || error.message}`);}
    if (host === 'codex') try {finalMessage = readBoundedText(finalPath, 16384);} catch (error) {errors.push(`final-message-rejected:${error.code || error.message}`);}
    if (typeof finalMessage !== 'string' || Buffer.byteLength(finalMessage) > 16384) {finalMessage = ''; errors.push('host-summary-byte-limit');}
    let after = []; try {after = fixtureSnapshot(root);} catch (error) {errors.push(`fixture-snapshot-rejected:${error.message}`);}
    const repaired = (() => {try {return readBoundedText(path.join(root, profile.target), profile.maxSourceBytes);} catch {return '';}})();
    if (!authorizedRepairSource(profile,repaired)) errors.push('independent-source-semantics-rejected');
    // Never execute drifted oracle/configuration or arbitrary changed source.
    const independent = errors.length || assessRepairDiff(before, after,profileName).length ? {complete: false, cases: [], errors: ['unsafe-or-incomplete-repair-not-executed']} : await independentRun(root, node,profileName);
    for (const [item, label] of [[node, 'node'], [identity, 'host'], [schemaIdentity, 'final-account-schema'], ...(identity.nativeBinary ? [[identity.nativeBinary, 'native-host']] : []), ...harness.map(item => [item, 'harness'])]) errors.push(...executableDrift(item, label));
    if (identity.nativeBinaryUnavailable) errors.push('native-host-binary-unavailable');
    try {if (JSON.stringify(hostIdentityFor(options[host], host)) !== JSON.stringify(identity)) errors.push('host-resolution-changed');
      if (packageSnapshot(options.entrypoint).sha256 !== snapshot.sha256) errors.push('package-source-changed');
      if (JSON.stringify(fixtureSnapshot(root)) !== JSON.stringify(after)) errors.push('fixture-changed-during-independent-run');
    } catch (error) {errors.push(`post-run-identity-rejected:${error.message}`);}
    const assessment = assessRepairLoop({processResult, observed, repair, before, after, baseline, planted, independent, finalMessage, entrypoint, node, hostErrors: errors,profileName});
    report.hosts.push({host, identity, finalAccountSchemaIdentity: schemaIdentity, invocation: {args, cwd: root}, ...assessment, baseline, planted, independent, before, after, observed, repair,
      process: {...processResult, stdout: undefined, stderr: undefined}, nativeApiRetriesObserved: events.nativeApiRetriesObserved});
    fs.writeFileSync(path.join(directory, 'independent-after.json'), JSON.stringify(independent), {mode: 0o600});
  }
  report.complete = report.hosts.length === 2 && report.hosts.every(row => row.qualified); report.finishedAt = new Date().toISOString(); return report;
}

export function parseRepairArguments(argv) {
  if (argv.filter(flag => flag === '--authorize-fixture-repair').length !== 1) throw new Error('Explicit one-time --authorize-fixture-repair required');
  const stripped=[],profileFlags=argv.filter(flag=>flag==='--repair-profile');let profileName='synthetic',instructions='supplied';
  if(profileFlags.length>1)throw new Error('Duplicate repair profile option');
  if(argv.filter(flag=>flag==='--repair-instructions').length>1)throw new Error('Duplicate repair instructions option');
  for(let index=0;index<argv.length;index++){
    if(argv[index]==='--repair-profile'){profileName=argv[++index];if(typeof profileName!=='string'||!['synthetic','maintainer-is-promise'].includes(profileName))throw new Error('Unknown named repair qualification profile');}
    else if(argv[index]==='--repair-instructions'){instructions=argv[++index];if(!['supplied','contract-only'].includes(instructions))throw new Error('Unknown repair instructions mode');}
    else if(argv[index]!=='--authorize-fixture-repair')stripped.push(argv[index]);
  }
  const options = parseHostArguments(stripped);
  if (!options.authorizeFixtureTools) throw new Error('--authorize-fixture-tools required');
  if(instructions==='contract-only'&&profileName!=='maintainer-is-promise')throw new Error('Contract-only instructions require the maintainer profile');
  repairHostSelection(options,profileName);
  return {...options,repairProfile:profileName,repairInstructions:instructions, authorizeFixtureRepair: true};
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseRepairArguments(argv);
  try {fs.lstatSync(options.output); throw new Error('Preserve previous evidence: output must be new');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  const report = await qualifyRepairHosts(options); fs.mkdirSync(path.dirname(options.output), {recursive: true});
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({complete: report.complete, output: options.output, hosts: report.hosts.map(({host, qualified, reasons}) => ({host, qualified, reasons}))}));
  return report.complete ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.exitCode = await main();} catch (error) {console.error(error.message); process.exitCode = 2;}
}
