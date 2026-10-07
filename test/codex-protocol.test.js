import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.js';
import { callAgent } from '../src/swarm.js';
import { codexRequest, runCodex, schemas } from '../src/adapters/codex.js';
import { CodexEventAudit, agreeResponse,describeWorkerFailure } from '../src/adapters/codex-protocol.js';

const reply = { tasks: [{ subject: 'src/a.js', instructions: 'Check public requirement ✓' }] };
const message = (text = JSON.stringify(reply), id = 'item_0') => ({ type: 'item.completed', item: { id, type: 'agent_message', text } });
const completed = { type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 4 } };
const prefix = [{ type: 'thread.started', thread_id: 'test-thread' }, { type: 'turn.started' }];
const valid = [...prefix, message(), completed];
const jsonl = events => events.map(event => JSON.stringify(event) + '\n').join('');
const audit = (events, limit = 2 * 1024 * 1024) => { const worker = new CodexEventAudit(limit); worker.push(Buffer.from(jsonl(events))); return worker.finish(); };
const code = expected => error => error.code === expected;
test('native error items remain rejected with bounded actionable diagnostics and no message disclosure',()=>{
 for(const [nativeMessage,reason]of [['HTTP 401 authentication private source sentinel','authentication'],['429 quota exceeded private source sentinel','usage-limit'],['stream disconnected private source sentinel','connectivity'],['context window exceeded private source sentinel','context-limit'],['private source sentinel','unclassified']]){
  try{audit([...prefix,{type:'item.completed',item:{id:'error',type:'error',message:nativeMessage}},message(),completed]);assert.fail('Native error item must reject');}catch(error){
   assert.equal(error.code,'NATIVE_ERROR_ITEM');const result=describeWorkerFailure(error);assert.equal(result.nativeFailureReason,reason);assert.ok(result.nextAction);assert.equal(JSON.stringify(result).includes('private source sentinel'),false);
  }
 }
 try{audit([...prefix,{type:'item.started',item:{id:'unknown',type:'future_private_source_sentinel',text:''}}]);assert.fail('Unknown native item must reject');}catch(error){const result=describeWorkerFailure(error);assert.equal(result.code,'ITEM_UNKNOWN');assert.match(result.nativeItemTypeSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(result).includes('future_private_source_sentinel'),false);}
});

test('audited JSONL supports split UTF-8, reasoning metadata and tool-less item lifecycles', () => {
  const events = [...prefix,
    { type: 'item.completed', item: { id: 'reason', type: 'reasoning', text: 'thinking', optionalMetadata: true } },
    { type: 'item.started', item: { id: 'answer', type: 'agent_message', text: '' } },
    { type: 'item.updated', item: { id: 'answer', type: 'agent_message', text: JSON.stringify(reply) } },
    message(JSON.stringify(reply), 'answer'), completed];
  const worker = new CodexEventAudit(2048), bytes = Buffer.from(jsonl(events));
  for (const byte of bytes) worker.push(Buffer.from([byte]));
  const result = worker.finish();
  assert.equal(result.eventCount, events.length);
  assert.deepEqual(agreeResponse(result.finalText, '  ' + JSON.stringify(reply, null, 2) + '\n', schemas.architect), reply);
});

test('every exposed tool attempt invalidates response, including declined or failed tools', () => {
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'todo_list', 'collab_tool_call', 'image_generation', 'dynamic_tool_call', 'function_call', 'custom_tool_call']) {
    for (const eventType of ['item.started', 'item.updated', 'item.completed']) {
      assert.throws(() => audit([...prefix, { type: eventType, item: { id: 'tool', type, status: 'failed', command: 'private source' } }, message(), completed]), code('TOOL_ATTEMPT'));
    }
  }
});

test('exit-like completion cannot rescue invalid, missing, unknown or reordered events', () => {
  const cases = [
    [[], 'EVENT_INCOMPLETE'], [[...prefix, message()], 'EVENT_INCOMPLETE'],
    [[...prefix, completed], 'EVENT_INCOMPLETE'],
    [[...valid, message()], 'EVENT_ORDER'], [[...prefix, message(), completed, completed], 'EVENT_ORDER'],
    [[message(), ...valid], 'EVENT_MALFORMED'], [[...prefix, { type: 'turn.started' }], 'EVENT_ORDER'],
    [[...prefix, { type: 'future.event', secret: 'do not echo' }], 'EVENT_UNKNOWN'],
    [[...prefix, { type: 'error', message: 'private content' }, message(), completed], 'TURN_FAILED'],
    [[...prefix, { type: 'turn.failed', error: { message: 'private content' } }], 'TURN_FAILED'],
    [[...prefix, { type: 'item.completed', item: { id: 'x', type: 'future_tool', text: '' } }], 'ITEM_UNKNOWN'],
    [[...prefix, { type: 'item.started', item: { id: 'x', type: 'reasoning', text: '' } }, message(), completed], 'EVENT_INCOMPLETE'],
    [[...prefix, message(), message(), completed], 'EVENT_ORDER'],
    [[...prefix, message(), { ...completed, usage: { ...completed.usage, input_tokens: -1 } }], 'EVENT_INCOMPLETE'],
    [[...prefix, message(), { ...completed, usage: null }], 'EVENT_INCOMPLETE'],
    [[...prefix, message(), { ...completed, usage: { ...completed.usage, future: 1 } }], 'EVENT_INCOMPLETE']
  ];
  for (const [events, expected] of cases) assert.throws(() => audit(events), code(expected));
});

test('malformed, truncated, excessive and invalid UTF-8 streams fail closed', () => {
  for (const [bytes, expected] of [[Buffer.from('{no}\n'), 'EVENT_MALFORMED'], [Buffer.from('\n'), 'EVENT_MALFORMED'], [Buffer.from(jsonl(valid).trimEnd()), 'EVENT_TRUNCATED'], [Buffer.from([0xff, 0x0a]), 'EVENT_UTF8'], [Buffer.from([0xe2]), 'EVENT_UTF8']]) {
    const worker = new CodexEventAudit(2048);
    assert.throws(() => { worker.push(bytes); worker.finish(); }, code(expected));
  }
  assert.throws(() => audit(valid, 10), code('OUTPUT_LIMIT'));
  const worker = new CodexEventAudit(2048, 1);
  assert.throws(() => worker.push(Buffer.from(jsonl(prefix))), code('EVENT_LIMIT'));
});

test('final event/file agreement and recursive schema are independently checked', () => {
  assert.throws(() => agreeResponse(JSON.stringify(reply), '{"tasks":[]}', schemas.architect), code('RESPONSE_MISMATCH'));
  assert.throws(() => agreeResponse('invalid', 'invalid', schemas.architect), code('RESPONSE_JSON'));
  for (const value of [{ tasks: [{ subject: 1, instructions: 'x' }] }, { tasks: [], extra: true }, [], null, { tasks: {} }]) {
    assert.throws(() => agreeResponse(JSON.stringify(value), JSON.stringify(value), schemas.architect), code('RESPONSE_SCHEMA'));
  }
  assert.equal(agreeResponse('{"accepted":false,"findings":[],"oracle":{"independent":true,"basis":["contract"]}}', '{"oracle":{"basis":["contract"],"independent":true},"findings":[],"accepted":false}', schemas.reviewer).accepted, false);
});

function fake(t, script) {
  const directory = fixture(t), bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  const executable = path.join(bin, 'codex'); fs.writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const output=args[args.indexOf('--output-last-message')+1];${script}`); fs.chmodSync(executable, 0o755);
  const request = codexRequest({ role: 'architect', requirements: 'private source sentinel' }, directory);
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  return { directory, request, env, executable };
}
const emitValid = `fs.writeFileSync(output,${JSON.stringify(JSON.stringify(reply))});process.stdout.write(${JSON.stringify(jsonl(valid))});`;

test('fake native executable must pass terminal, file and identity audit', async t => {
  const { directory, request, env, executable } = fake(t, emitValid);
  const { value, audit } = await runCodex(request.args, request.prompt, directory, env);
  assert.deepEqual(value, reply); assert.equal(audit.complete, true); assert.equal(audit.toolAttempts, 0);
  assert.equal(audit.resolvedExecutable, fs.realpathSync(executable)); assert.equal(audit.observedModel, null);
  for (const key of ['executableSha256', 'schemaSha256', 'adapterSha256', 'protocolSha256', 'responseSha256']) assert.match(audit[key], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(audit).includes('private source sentinel'), false);
});
test('relative PATH entries resolve from the native child working directory',async t=>{
  const {directory,request,env,executable}=fake(t,emitValid);env.PATH='bin';
  const {value,audit}=await runCodex(request.args,request.prompt,directory,env);
  assert.deepEqual(value,reply);assert.equal(audit.requestedExecutablePath,executable);
});

test('fake exit zero with no terminal, missing response, symlink, malformed file or disagreement is rejected', async t => {
  const cases = [
    ["fs.writeFileSync(output,'{}');", 'EVENT_INCOMPLETE'],
    [`process.stdout.write(${JSON.stringify(jsonl(valid))});`, 'RESPONSE_FILE'],
    [`fs.writeFileSync(output, '{"tasks":[]}');process.stdout.write(${JSON.stringify(jsonl(valid))});`, 'RESPONSE_MISMATCH'],
    [`fs.writeFileSync(output,'invalid');process.stdout.write(${JSON.stringify(jsonl(valid))});`, 'RESPONSE_JSON'],
    [`fs.writeFileSync(output+'.target',${JSON.stringify(JSON.stringify(reply))});fs.symlinkSync(output+'.target',output);process.stdout.write(${JSON.stringify(jsonl(valid))});`, 'RESPONSE_FILE'],
    ["process.stderr.write('private source sentinel');process.exitCode=7;", 'CLI_EXIT']
  ];
  for (const [script, expected] of cases) {
    const { directory, request, env } = fake(t, script);
    await assert.rejects(runCodex(request.args, request.prompt, directory, env), error => error.code === expected && !error.message.includes('private source sentinel'));
  }
});

test('declared stream/file budgets and deadlines are enforced', async t => {
  for (const [script, expected, budget] of [
    ["process.stdout.write('x'.repeat(1100));", 'OUTPUT_LIMIT', { maxOutputBytes: 1024 }],
    ["process.stderr.write('x'.repeat(1100));", 'OUTPUT_LIMIT', { maxOutputBytes: 1024 }],
    [`fs.writeFileSync(output,'x'.repeat(1100));process.stdout.write(${JSON.stringify(jsonl(valid))});`, 'OUTPUT_LIMIT', { maxOutputBytes: 1024 }],
    ['setInterval(()=>{},1000);', 'DEADLINE', { timeout: 150 }]
  ]) {
    const { directory, request, env } = fake(t, script);
    await assert.rejects(runCodex(request.args, request.prompt, directory, env, budget.timeout ? { deadlineAt: Date.now() + budget.timeout } : budget), code(expected));
  }
});

test('main preserves exact structured stdout and strips provider keys without auth changes', t => {
  const script = `let prompt='';process.stdin.on('data',data=>prompt+=data);process.stdin.on('end',()=>{if(['OPENAI_API_KEY','CODEX_API_KEY','AZURE_OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY'].some(key=>process.env[key])||process.env.CODEX_HOME!=='auth-home')process.exitCode=4;else{${emitValid}}});`;
  const { env } = fake(t, script);
  for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']) env[name] = 'secret';
  env.CODEX_HOME = 'auth-home';
  const adapter = fileURLToPath(new URL('../src/adapters/codex.js', import.meta.url));
  const result = spawnSync(process.execPath, [adapter], { env, input: JSON.stringify({ role: 'architect' }), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, JSON.stringify(reply));
  assert.equal(result.stderr, '');
});
test('opt-in evaluation worker retains audited usage without changing role fields',t=>{
 const {env}=fake(t,emitValid);
 const worker=fileURLToPath(new URL('../scripts/codex-evaluation-worker.js',import.meta.url));
 const result=spawnSync(process.execPath,[worker],{env,input:JSON.stringify({role:'architect'}),encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);const {_testloreNativeAudit:audit,...value}=JSON.parse(result.stdout);
 assert.deepEqual(value,reply);assert.equal(audit.complete,true);assert.equal(audit.toolAttempts,0);
 assert.deepEqual(audit.usage,valid.at(-1).usage);assert.equal(audit.observedModel,null);
 const rejected=spawnSync(process.execPath,[worker,'--unexpected'],{env,input:'{}',encoding:'utf8',timeout:5000});assert.equal(rejected.status,1);
});


test('preexisting response evidence is rejected intact and CLI/schema drift invalidates success', async t => {
  const existing = fake(t, emitValid); fs.writeFileSync(existing.request.output, 'previous evidence');
  await assert.rejects(runCodex(existing.request.args, existing.request.prompt, existing.directory, existing.env), code('RESPONSE_EXISTS'));
  assert.equal(fs.readFileSync(existing.request.output, 'utf8'), 'previous evidence');
  for (const change of ["fs.appendFileSync(__filename,'\\n//changed');", "fs.appendFileSync(args[args.indexOf('--output-schema')+1],' ');"]) {
    const { directory, request, env } = fake(t, change + emitValid);
    await assert.rejects(runCodex(request.args, request.prompt, directory, env), code('IDENTITY_DRIFT'));
  }
});


test('PATH symlink replacement during invocation is detected', async t => {
  if (process.platform === 'win32') return t.skip('POSIX symlink fixture');
  const { directory, request, env, executable } = fake(t, `fs.unlinkSync(process.env.CODEX_TEST_LINK);fs.symlinkSync(process.env.CODEX_TEST_OTHER,process.env.CODEX_TEST_LINK);${emitValid}`);
  const linkBin = path.join(directory, 'linked-bin'); fs.mkdirSync(linkBin);
  const link = path.join(linkBin, 'codex'), other = path.join(directory, 'other-codex');
  fs.copyFileSync(executable, other); fs.chmodSync(other, 0o755); fs.symlinkSync(executable, link);
  env.PATH = linkBin + path.delimiter + env.PATH; env.CODEX_TEST_LINK = link; env.CODEX_TEST_OTHER = other;
  await assert.rejects(runCodex(request.args, request.prompt, directory, env), code('IDENTITY_DRIFT'));
});

test('success and timeout terminate child process groups including inherited descendants', async t => {
  if (process.platform === 'win32') return t.skip('POSIX process group fixture');
  for (const timedOut of [false, true]) {
    const { directory, request, env } = fake(t, `require('node:child_process').spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'survived'),700)",output+'.descendant'],{stdio:'ignore'}).unref();${timedOut ? 'setInterval(()=>{},1000);' : emitValid}`);
    if (timedOut) await assert.rejects(runCodex(request.args, request.prompt, directory, env, { deadlineAt: Date.now() + 500 }), code('DEADLINE'));
    else await runCodex(request.args, request.prompt, directory, env);
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(fs.existsSync(request.output + '.descendant'), false);
  }
});

test('invalid budgets and requests fail before starting the executable', async t => {
  const { directory, request, env } = fake(t, emitValid);
  for (const budget of [null, [], { maxOutputBytes: 2 * 1024 * 1024 + 1 }, { deadlineAt: Infinity }, { maxOutputBytes: 100 }]) await assert.rejects(runCodex(request.args, request.prompt, directory, env, budget), code('BUDGET_INVALID'));
  await assert.rejects(runCodex([...request.args, '--dangerously-bypass-approvals-and-sandbox'], request.prompt, directory, env), code('REQUEST_INVALID'));
  assert.equal(fs.existsSync(request.output), false);
});


test('callAgent to main preserves caller group cleanup on outer timeout and local audit failure', async t => {
  if (process.platform === 'win32') return t.skip('POSIX caller process group fixture');
  for (const outerTimeout of [true, false]) {
    const { directory, env } = fake(t, `require('node:child_process').spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'orphan'),900)",process.env.CODEX_TEST_ORPHAN],{stdio:'ignore'}).unref();${outerTimeout ? 'setInterval(()=>{},1000);' : "process.stdout.write(JSON.stringify({type:'item.started',item:{id:'tool',type:'command_execution',command:'forbidden'}})+'\\n');setInterval(()=>{},1000);"}`);
    const marker = path.join(directory, 'orphan-marker'), wrapper = path.join(directory, 'adapter-wrapper.mjs');
    const adapter = new URL('../src/adapters/codex.js', import.meta.url).href;
    fs.writeFileSync(wrapper, `process.env.PATH=${JSON.stringify(env.PATH)};process.env.CODEX_TEST_ORPHAN=${JSON.stringify(marker)};const {main}=await import(${JSON.stringify(adapter)});try{await main();}catch(error){console.error(error.code);process.exitCode=1;}`);
    await assert.rejects(callAgent([process.execPath, wrapper], { role: 'architect' }, directory, outerTimeout ? 600 : 2500), outerTimeout ? /timed out/ : /TOOL_ATTEMPT/);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(fs.existsSync(marker), false, 'caller deadline or rejection must not leave native CLI descendants');
  }
});
