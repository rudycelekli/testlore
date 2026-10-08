import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { listFiles, TEST, normalize, safePath } from './files.js';
import {normalizeNativeProjects} from './native-project-contracts.js';

const reporter = fileURLToPath(new URL('./reporters/node.js', import.meta.url));
const playwrightReporter = fileURLToPath(new URL('./reporters/playwright.cjs', import.meta.url));
export function adapterFor(config = {}) {
  if (config.adapter) return config.adapter;
  const argv = config.runner || ['node', '--test', '{files}'];
  if (argv.some(x => /(?:^|[/\\])vitest(?:\.mjs)?$/.test(x))) return 'vitest';
  if (argv.some(x => /(?:^|[/\\])jest(?:\.js)?$/.test(x))) return 'jest';
  if (argv.some(x => /(?:^|[/\\])playwright(?:\.m?js|\.cmd)?$/.test(x)) || argv.some(x => /[/\\](?:@playwright[/\\]test|playwright)[/\\]cli\.js$/.test(x))) return 'playwright';
  return argv.includes('--test') ? 'node' : 'custom';
}
export function nativeEnvironment(config) {
  const env = { ...process.env, ...config.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
function spawn(root, command, config, options = {}) {
  const requestedTimeout=options.timeoutMs ?? config.runnerTimeoutMs ?? 120000;
  const timeout=Number.isInteger(requestedTimeout)&&requestedTimeout>0?requestedTimeout:120000;
  return spawnSync(command[0], command.slice(1), {
    cwd: root, env: nativeEnvironment(config), shell: false, encoding: 'utf8',
    stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
    timeout, killSignal: 'SIGKILL'
  });
}
function localFile(root, file) {
  if (typeof file !== 'string') throw new Error('Runner reported a non-string file');
  const base = fs.realpathSync(root);
  const absolute = path.isAbsolute(file) && fs.existsSync(file) ? fs.realpathSync(file) : file;
  const relative = normalize(path.isAbsolute(absolute) ? path.relative(base, absolute) : absolute);
  safePath(root, relative);
  return relative;
}
function commandBase(config, adapter, root) {
  let playwright;
  if(adapter==='playwright' && !config.runner) {
    const require=createRequire(path.join(root,'package.json'));
    playwright=[process.execPath,require.resolve('@playwright/test/cli'), 'test', '{files}'];
  }
  const argv = config.runner || playwright || (adapter === 'jest' ? ['jest', '{files}'] : adapter === 'vitest' ? ['vitest', 'run', '{files}'] : ['node', '--test', '{files}']);
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string' || !x)) throw new Error('runner must be a nonempty argv array');
  return argv;
}
function playwrightCommand(base, reportFile, files, discovery=false) {
  const command=[];
  const unsupported=/^(?:--(?:grep|grep-invert|shard|last-failed|last-failed-file|test-list|test-list-invert|only-changed|no-deps|pass-with-no-tests|ui(?:-host|-port)?|debug|ignore-snapshots|update-snapshots|update-source-method|run-agents|list)|-[gGuxh])(?:=|$)/;
  const subcommand=base.indexOf('test');
  if(subcommand<1)throw new Error('Playwright runner must invoke the test subcommand');
  const valued=new Set(['-c','--config','--browser','-j','--workers','--global-timeout','--max-failures','--repeat-each','--retries','--timeout','--trace','--tsconfig']);
  const switches=new Set(['--forbid-only','--fully-parallel','--headed','--quiet','--fail-on-flaky-tests']);
  for(let i=0;i<base.length;i++) {
    const arg=base[i]; if(arg==='{files}')continue;
    if(i<=subcommand){command.push(arg);continue;}
    if(unsupported.test(arg))throw new Error(`Unsupported Playwright scope or mutation option: ${arg}`);
    const option=arg.split('=')[0];
    if(['--reporter','--add-reporter','--output'].includes(option)){
      if(!arg.includes('=')){if(!base[i+1]||base[i+1]==='{files}')throw new Error(`Missing Playwright option value: ${arg}`);i++;}continue;
    }
    command.push(arg);
    if(option==='--project') {
      if(!arg.includes('=')){let count=0;while(base[i+1]&&base[i+1]!=='{files}'&&!base[i+1].startsWith('-')){command.push(base[++i]);count++;}if(!count)throw new Error('Missing Playwright project value');}
    } else if(valued.has(option)) {
      if(!arg.includes('=')){if(!base[i+1]||base[i+1]==='{files}')throw new Error(`Missing Playwright option value: ${arg}`);command.push(base[++i]);}
    } else if(!switches.has(option))throw new Error(`Unsupported Playwright argument or positional test filter: ${arg}`);
  }
  command.push(`--reporter=${playwrightReporter}`,'--forbid-only','--update-snapshots=none',`--output=${path.join(path.dirname(reportFile),'artifacts')}`);
  if(discovery)command.push('--list');
  else for(const file of files)command.push(path.resolve(file.root,file.path).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
  return command;
}
function playwrightResults(root,value,discovery=false) {
  if(value?.schemaVersion!==1||value.adapter!=='playwright'||!value.began||!value.ended||!value.exited||!Array.isArray(value.inventory)||!Array.isArray(value.tests)||!Array.isArray(value.errors)||!Array.isArray(value.projects))throw new Error('Missing complete Playwright reporter lifecycle');
  const collectionFiles=[...new Set(value.inventory.map(test=>localFile(root,test.file)))].sort();
  const errors=[...value.errors];
  if(!value.inventory.length)errors.push('empty-native-scope');
  if(!['passed','failed'].includes(value.nativeStatus))errors.push(`incomplete-native-status:${value.nativeStatus}`);
  const key=test=>JSON.stringify([test.nativeId,test.repeatEachIndex]);
  const inventory=new Map(value.inventory.map(test=>[key(test),test]));
  if(inventory.size!==value.inventory.length)errors.push('duplicate-native-case-identity');
  const observed=new Set();
  const tests=value.tests.map(test=>{
    const identity=key(test), collected=inventory.get(identity);
    const sameCollection=collected&&Object.keys(collected).filter(k=>k!=='expectedStatus').every(k=>JSON.stringify(collected[k])===JSON.stringify(test[k]));
    if(!sameCollection||observed.has(identity))errors.push('native-case-inventory-mismatch');
    observed.add(identity);
    if(!Array.isArray(test.attempts))throw new Error('Missing native case attempts');
    const last=test.attempts.at(-1);
    if(!discovery && (!last||last.status==='interrupted'))errors.push('native-case-unfinished');
    let status='failed';
    if(test.outcome==='skipped' && (last?.status==='skipped'||discovery))status='skipped';
    else if(test.outcome==='expected' && test.expectedStatus==='passed' && last?.status==='passed' && test.attempts.every(a=>a.status==='passed'))status='passed';
    else if(!['expected','unexpected','flaky','skipped'].includes(test.outcome))errors.push('unknown-native-outcome');
    const file=localFile(root,test.file);
    // Project/repeat belongs in the semantic name so existing preservation gates
    // cannot replace a case from another browser project with a same-title case.
    const name=JSON.stringify({project:test.project,repeat:test.repeatEachIndex,title:test.titles});
    return {file,name,title:test.title,project:test.project,repeatEachIndex:test.repeatEachIndex,nativeId:test.nativeId,status,outcome:test.outcome,expectedStatus:test.expectedStatus,attempts:test.attempts,durationMs:test.attempts.reduce((n,a)=>n+a.durationMs,0),line:test.line,column:test.column};
  });
  if(observed.size!==inventory.size)errors.push('native-case-inventory-incomplete');
  return {tests,collectionFiles,errors,valid:true,projects:value.projects,nativeStatus:value.nativeStatus};
}
function withoutFiles(command) { return command.filter(x => x !== '{files}'); }
function frameworkBase(command, adapter) {
  const argv = withoutFiles(command);
  if (adapter === 'vitest') {
    const index = argv.findIndex(x => /(?:^|[/\\])vitest(?:\.mjs)?$/.test(x));
    if (['run', 'list', 'watch', 'related'].includes(argv[index + 1])) argv.splice(index + 1, 1);
  }
  return argv;
}
function nodeCommand(base, report, files, discovery = false) {
  // Retain runtime/preload settings but own reporters so completeness is verifiable.
  const command = [];
  for (let i = 0; i < base.length; i++) {
    const arg = base[i];
    if (arg === '{files}') continue;
    if (/^--test-reporter(?:-destination)?=/.test(arg)) continue;
    if (['--test-reporter', '--test-reporter-destination'].includes(arg)) { i++; continue; }
    command.push(arg);
  }
  command.push(`--test-reporter=${reporter}`, `--test-reporter-destination=${report}`);
  if (discovery) command.push('--test-name-pattern=(?!)');
  else command.push(...files.map(f => './' + f));
  return command;
}
function nodeEvents(root, text) {
  const events = text.split('\n').filter(x => x.startsWith('@tddswarm:')).map(x => JSON.parse(x.slice(10)));
  const collectionFiles = new Set();
  const names = new Map();
  const hierarchy = new Map();
  let completeHierarchy=true;
  // Node can enqueue every sibling suite before enqueueing their children.
  // Terminal suite events follow their children in reporter tree order. Walking
  // backwards reconstructs the actual ancestry, including concurrent siblings.
  // Key by event identity: dynamic cases can share source line/column/nesting.
  for(let index=events.length-1;index>=0;index--){
    const event=events[index],{type,data}=event;
    if(!['test:pass','test:fail'].includes(type)||!data.file)continue;
    let file;try{file=localFile(root,data.file);}catch{continue;}
    const nesting=data.nesting??0;
    if(!Number.isInteger(nesting)||nesting<0||nesting>128||typeof data.name!=='string'){completeHierarchy=false;continue;}
    const ancestors=hierarchy.get(file)||[];ancestors[nesting]=data.name;ancestors.length=nesting+1;hierarchy.set(file,ancestors);
    if(Array.from({length:nesting},(_,i)=>ancestors[i]).some(name=>typeof name!=='string')){completeHierarchy=false;continue;}
    names.set(event,ancestors.join(' > '));
  }
  let stdout = '', stderr = '';
  const tests = [];
  let summary = false;
  let summaryCounts;
  for (const event of events) {
    const {type,data}=event;
    if (type === 'test:stdout') stdout += data.message || '';
    if (type === 'test:stderr') stderr += data.message || '';
    let file;
    try { if (data.file) file = localFile(root, data.file); } catch { continue; }
    if (type === 'test:summary' && !data.file) { summary = true; summaryCounts = data.counts; }
    if (file) collectionFiles.add(file);
    if (!['test:pass', 'test:fail'].includes(type) || !file || data.details?.type === 'suite') continue;
    // Synthetic file wrappers are useful collection evidence but aren't cases.
    if (data.name === path.join(root, file) || data.name === file) {
      if (type === 'test:fail') tests.push({ file, name: '<file-load>', status: 'failed', durationMs: data.details?.duration_ms || 0, line: 0, column: 0 });
      continue;
    }
    tests.push({ file, name: names.get(event) || data.name, status: data.skip || data.todo ? 'skipped' : type === 'test:pass' ? 'passed' : 'failed', durationMs: data.details?.duration_ms || 0, line: data.line, column: data.column });
  }
  // Native counts include synthetic empty/load files. Named case counts may be
  // lower, but they must never exceed what the terminal summary acknowledges.
  const validCounts = Number.isInteger(summaryCounts?.tests) && tests.length <= summaryCounts.tests;
  return { tests, collectionFiles: [...collectionFiles].sort(), valid: summary && validCounts&&completeHierarchy, errors: completeHierarchy?[]:['native-case-ancestry-incomplete'], stdout, stderr };
}
function frameworkResults(root, value) {
  if (!value || !Array.isArray(value.testResults)) throw new Error('Missing testResults in runner report');
  const tests = [];
  const collectionFiles = [];
  for (const suite of value.testResults) {
    const file = localFile(root, suite.name || suite.testFilePath);
    collectionFiles.push(file);
    if (!Array.isArray(suite.assertionResults)) throw new Error('Missing assertionResults in runner report');
    for (const assertion of suite.assertionResults) {
      const status = ['pending', 'todo', 'disabled', 'skipped'].includes(assertion.status) ? 'skipped' : assertion.status;
      if (!['passed', 'failed', 'skipped'].includes(status)) throw new Error(`Unknown case status: ${status}`);
      tests.push({ file, name: assertion.fullName || [...(assertion.ancestorTitles || []), assertion.title].join(' '), status, durationMs: assertion.duration ?? 0 });
    }
    if (suite.status === 'failed' && !suite.assertionResults.some(t => t.status === 'failed')) {
      tests.push({ file, name: '<file-load>', status: 'failed', durationMs: 0 });
    }
  }
  const errors = (value.testExecError ? [value.testExecError] : []).concat(value.numRuntimeErrorTestSuites ? ['runtime-error-test-suites'] : []);
  return { tests, collectionFiles: [...new Set(collectionFiles)].sort(), valid: typeof value.success === 'boolean' && (!Number.isInteger(value.numTotalTests) || value.numTotalTests === tests.filter(t => t.name !== '<file-load>').length), errors };
}
function identities(tests) {
  const counts = new Map();
  return tests.map(test => {
    const key = `${test.file}\0${test.name}\0${test.line || ''}\0${test.column || ''}`;
    const ordinal = counts.get(key) || 0; counts.set(key, ordinal + 1);
    return { ...test, id: createHash('sha256').update(key + '\0' + ordinal).digest('hex') };
  });
}

/** Execute exact requested files. Unsupported runners never certify report completeness. */
export function execute(root, files, config = {}, options = {}) {
  root = path.resolve(root);
  files = [...new Set(files.map(file => localFile(root, file)))].sort();
  const adapter = adapterFor(config);
  if (!files.length) return { adapter, exitCode: adapter==='playwright'?2:0, tests: [], collectionFiles: [], requestedFiles: [], executedFiles: [], complete: adapter!=='playwright', durationMs: 0, command: [], stdout: '', stderr: '' };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-report-'));
  const reportFile = path.join(temporary, 'results.json');
  let base;
  try {base=commandBase(config, adapter, root);}catch(error){fs.rmSync(temporary,{recursive:true,force:true});return {adapter,exitCode:2,complete:false,tests:[],collectionFiles:[],requestedFiles:files,executedFiles:[],error:error.message};}
  let command;
  if (adapter === 'node') command = nodeCommand(base, reportFile, files);
  else if (adapter === 'jest') command = [...frameworkBase(base, adapter), '--runTestsByPath', '--watch=false', '--json', `--outputFile=${reportFile}`, ...files.map(f => './' + f)];
  else if (adapter === 'vitest') command = [...frameworkBase(base, adapter), 'run', '--reporter=json', `--outputFile=${reportFile}`, ...files.map(f => './' + f)];
  else if (adapter === 'playwright') {
    try { command=playwrightCommand(base,reportFile,files.map(file=>({root,path:file}))); }
    catch(error){fs.rmSync(temporary,{recursive:true,force:true});return {adapter,exitCode:2,complete:false,tests:[],collectionFiles:[],requestedFiles:files,executedFiles:[],error:error.message};}
  }
  else command = base.flatMap(x => x === '{files}' ? files.map(f => './' + f) : [x]);
  const start = performance.now();
  const result = spawn(root, command, adapter==='playwright'?{...config,env:{...config.env,TESTLORE_PLAYWRIGHT_REPORT:reportFile}}:config, options);
  let normalized = { tests: [], collectionFiles: [], valid: false, errors: [] };
  let reportError;
  try {
    if (adapter === 'node') normalized = nodeEvents(root, fs.readFileSync(reportFile, 'utf8'));
    else if (['jest', 'vitest'].includes(adapter)) normalized = frameworkResults(root, JSON.parse(fs.readFileSync(reportFile, 'utf8')));
    else if (adapter==='playwright')normalized=playwrightResults(root,JSON.parse(fs.readFileSync(reportFile,'utf8')));

  } catch (error) { reportError = error.message; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const missingFiles = files.filter(f => !normalized.collectionFiles.includes(f));
  const unknownFiles = normalized.collectionFiles.filter(f => !files.includes(f));
  // Playwright automatically includes configured setup/teardown dependency
  // projects. They are measured and reported, not silently filtered away.
  const dependencyFiles = adapter==='playwright'?unknownFiles.filter(file=>normalized.tests.filter(test=>test.file===file).every(test=>normalized.projects.some(project=>project.dependencies?.includes(test.project)||project.teardown===test.project))):[];
  const unexpectedFiles=unknownFiles.filter(file=>!dependencyFiles.includes(file));
  const complete = normalized.valid && !result.error && !result.signal && !missingFiles.length && !unexpectedFiles.length && !normalized.errors.length;
  const tests = identities(normalized.tests);
  // A success exit without a valid supported report is an execution failure.
  const unreportedSuccess = result.status === 0 && adapter !== 'custom' && !complete;
  const exitCode = unreportedSuccess ? 2 : adapter==='playwright'&&result.status===0&&tests.some(test=>test.status==='failed') ? 1 : result.status ?? 1;
  const stdout = (result.stdout || '') + (normalized.stdout || '');
  const stderr = (result.stderr || '') + (normalized.stderr || '');
  if (!options.capture) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { adapter, exitCode, durationMs: Math.round(performance.now() - start), tests, collectionFiles: normalized.collectionFiles,
    requestedFiles: files, executedFiles: adapter==='playwright'?normalized.collectionFiles:files, missingFiles, unknownFiles, dependencyFiles, complete,
    ...(adapter==='playwright'?{projects:normalized.projects,nativeStatus:normalized.nativeStatus,nativeExitCode:result.status}:{}),
    command, stdout, stderr, signal: result.signal,
    error: result.error?.message || (unreportedSuccess ? 'Runner report is incomplete; successful execution cannot be verified.' : reportError), reportErrors: normalized.errors };
}

/** Run the framework's own dependency selector for comparative measurements. */
export function executeNativeRelated(root, changed, config = {}, options = {}) {
 root=path.resolve(root);const adapter=adapterFor(config);
 if(!['vitest','jest'].includes(adapter))throw new Error('Native related selection requires Vitest or Jest');
 changed=[...new Set(changed.map(file=>localFile(root,file)))].sort();
 if(!changed.length)throw new Error('Native comparison needs the complete Git change set');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-native-related-')),reportFile=path.join(directory,'results.json');
 const base=frameworkBase(commandBase(config,adapter,root),adapter).filter(arg=>arg!=='--runTestsByPath');
 const command=adapter==='vitest'?[...base,'related',...changed.map(file=>'./'+file),'--run','--passWithNoTests','--reporter=json',`--outputFile=${reportFile}`]:[...base,'--findRelatedTests',...changed.map(file=>'./'+file),'--watch=false','--passWithNoTests','--json',`--outputFile=${reportFile}`];
 const start=performance.now();let result,normalized={tests:[],collectionFiles:[],valid:false,errors:[]},error;
 try{result=spawn(root,command,config,options);normalized=frameworkResults(root,JSON.parse(fs.readFileSync(reportFile,'utf8')));}catch(e){error=e.message;}finally{fs.rmSync(directory,{recursive:true,force:true});}
 const complete=normalized.valid&&!result?.error&&!result?.signal&&!normalized.errors.length;
 return {adapter,selector:adapter==='vitest'?'vitest-related':'jest-findRelatedTests',command,complete,exitCode:result?.status===0&&!complete?2:result?.status??2,tests:identities(normalized.tests),executedFiles:normalized.collectionFiles,collectionFiles:normalized.collectionFiles,durationMs:Math.round(performance.now()-start),stdout:result?.stdout||'',stderr:result?.stderr||'',error:result?.error?.message||error,reportErrors:normalized.errors};
}

/** Native discovery can evaluate module top-level code. It never writes run history. */
export function discover(root, config = {}) {
  root = path.resolve(root);
  const adapter = adapterFor(config);
  const fallback = () => listFiles(root).filter(f => TEST.test(f));
  if (config.discovery !== 'native' && !Array.isArray(config.discovery)) return { files: fallback(), complete: true, adapter: 'filesystem', warnings: [] };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-discovery-'));
  const reportFile = path.join(temporary, 'files.json');
  let result;
  try {
    let command;
    if (Array.isArray(config.discovery)) command = config.discovery;
    else if (adapter === 'node') command = nodeCommand(commandBase(config, adapter,root), reportFile, [], true);
    else if (adapter === 'jest') command = [...frameworkBase(commandBase(config, adapter,root), adapter), '--listTests', '--json', '--watch=false'];
    else if (adapter === 'vitest') command = [...frameworkBase(commandBase(config, adapter,root), adapter), 'list', '--filesOnly', `--json=${reportFile}`];
    else if (adapter==='playwright') command=playwrightCommand(commandBase(config,adapter,root),reportFile,[],true);
    else throw new Error('Custom native discovery requires a discovery argv array');
    result = spawn(root, command, adapter==='playwright'?{...config,env:{...config.env,TESTLORE_PLAYWRIGHT_REPORT:reportFile}}:config);
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `Discovery exited ${result.status}`);
    let files, complete = true;
    if (Array.isArray(config.discovery)) {
      const value = JSON.parse(result.stdout);
      if (!Array.isArray(value.files) || typeof value.complete !== 'boolean') throw new Error('Custom discovery must output {files: string[], complete: boolean}');
      files = value.files; complete = value.complete;
    } else if (adapter === 'node') {
      const report = nodeEvents(root, fs.readFileSync(reportFile, 'utf8'));
      files = report.collectionFiles; complete = report.valid;
    } else if(adapter==='playwright') {
      const report=playwrightResults(root,JSON.parse(fs.readFileSync(reportFile,'utf8')),true);
      files=report.collectionFiles;complete=report.valid&&!report.errors.length;
    } else {
      const value = JSON.parse(adapter === 'vitest' ? fs.readFileSync(reportFile, 'utf8') : result.stdout);
      if (!Array.isArray(value)) throw new Error('Native discovery report must be a file array');
      files = value.map(file => typeof file === 'string' ? file : file.filepath || file.file);
    }
    files = [...new Set(files.map(file => localFile(root, file)))].sort();
    for (const file of files) if (!fs.statSync(safePath(root, file)).isFile()) throw new Error(`Discovered file is missing: ${file}`);
    return { files, complete, adapter, warnings: complete ? [] : ['native-discovery-incomplete'] };
  } catch (error) {
    return { files: fallback(), complete: false, adapter, warnings: [`native-discovery-failed:${error.message.trim().slice(0, 500)}`] };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

/** Resolve a graph's imports with one framework config/server setup. */
export function resolveNativeBatch(root, imports, config = {}, options = {}) {
  const adapter = adapterFor(config);
  if (!['jest', 'vitest'].includes(adapter)) return { resolutions: [], configFiles: [], complete: true, adapter, supported: false };
  if(adapter==='vitest'&&!vitestInterpreterBound(root,config))return {resolutions:imports.map(()=>({paths:[],unresolved:true})),configFiles:[],adapter,supported:true,complete:false,error:'Requested native Node interpreter is unbound or differs from the resolver runtime'};
  const sharedCommand=options.discover?sharedVitestCommand(root,config):null;
  if(options.discover&&!sharedCommand)return {resolutions:imports.map(()=>({paths:[],unresolved:true})),configFiles:[],adapter,supported:true,complete:false,error:'Unsupported or unbound shared native command'};
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-resolution-'));
  const requestFile = path.join(temporary, 'request.json');
  try {
    const originalCommand=frameworkBase(commandBase(config,adapter),adapter);
    const cliIndex=originalCommand.findIndex(arg=>/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
    const invocation=sharedCommand?[process.execPath,path.resolve(root,originalCommand[cliIndex]),...originalCommand.slice(cliIndex+1),'list','--filesOnly',`--json=${path.join(temporary,'native-files.json')}`]:undefined;
    fs.writeFileSync(requestFile, JSON.stringify({ root: fs.realpathSync(root), adapter, imports, invocation, discover: options.discover === true, transitive: options.transitive === true, roots: options.roots || [], command: sharedCommand||originalCommand }));
    const script = fileURLToPath(new URL('./reporters/resolve.js', import.meta.url));
    const result = spawn(root, [process.execPath, script, requestFile], config);
    if (result.status !== 0 || result.error) throw new Error(result.error?.message || 'Native resolver failed');
    const value = JSON.parse(result.stdout);
    if (!Array.isArray(value.resolutions) || value.resolutions.length !== imports.length || typeof value.complete !== 'boolean') throw new Error('Invalid native resolver report');
    const resolutions = value.resolutions.map(resolution => ({ ...resolution, paths: (resolution.paths || []).map(file => localFile(root, file)) }));
    const additionalResolutions = (value.additionalResolutions || []).map(item=>{
      if(typeof item.file!=='string' || typeof item.specifier!=='string' || !item.resolution || !Array.isArray(item.resolution.paths))throw new Error('Invalid transitive native resolution');
      return {file:localFile(root,path.resolve(root,item.file)),specifier:item.specifier,resolution:{...item.resolution,paths:item.resolution.paths.map(file=>localFile(root,file))}};
    });
    const configFiles = (value.configFiles || []).flatMap(file => {
      if(typeof file==='string' && file.split(path.sep).includes('node_modules'))return [];
      try { return [localFile(root, file)]; } catch { value.complete=false; value.error='Native config dependency is outside the observed project'; return []; }
    });
    let discovery;
    if(options.discover) {
      if(!Array.isArray(value.discovery?.files)||typeof value.discovery?.complete!=='boolean')throw new Error(value.error||'Invalid combined native discovery report');
      const files=[...new Set(value.discovery.files.map(file=>localFile(root,file)))].sort();
      for(const file of files)if(!fs.statSync(safePath(root,file)).isFile())throw new Error('Combined native discovery reported a missing file');
      discovery={files,complete:value.discovery.complete,adapter,method:'fresh-shared-native-context',warnings:[]};
    }
    const projectContracts=value.projectContracts===undefined?undefined:normalizeNativeProjects(root,value.projectContracts,discovery?.files||[],localFile);
    return { ...value, ...(discovery?{discovery}:{}), ...(projectContracts?{projectContracts}:{}), resolutions, additionalResolutions, configFiles, adapter, supported: true };
  } catch (error) {
    return { resolutions: imports.map(() => ({paths: [], unresolved: true})), configFiles: [], adapter, supported: true, complete: false, error: error.message };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

/** Only the explicitly supported CLI/version gets the shared fresh-context path. */
export function combinedNativePlanningSupported(root, config={}) {
  if(config.discovery!=='native'||adapterFor(config)!=='vitest')return false;
  return sharedVitestCommand(root,config)!==null;
}
function effectiveExecutable(root,executable,env) {
  const candidates=path.isAbsolute(executable)||executable.includes(path.sep)?[path.resolve(root,executable)]
    :typeof env.PATH==='string'?env.PATH.split(path.delimiter).map(directory=>path.resolve(root,directory||'.',executable)):[];
  for(const candidate of candidates) {
    try {fs.accessSync(candidate,fs.constants.X_OK);if(fs.statSync(candidate).isFile())return fs.realpathSync(candidate);}catch{}
  }
  return null;
}
function vitestInterpreterBound(root,config) {
  try {
    const base=frameworkBase(commandBase(config,'vitest',root),'vitest');
    const index=base.findIndex(arg=>/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
    if(index===0) {
      const selected=canonicalVitestCLI(root,base[0]);if(!selected)return false;
      const line=readNativeIdentityFile(selected.cli,256).toString('utf8').split('\n',1)[0];
      const node=line==='#!/usr/bin/env node'?'node':/^#!(\/[^\s]+)$/.exec(line)?.[1];
      return Boolean(node)&&effectiveExecutable(root,node,nativeEnvironment(config))===fs.realpathSync(process.execPath);
    }
    // Legacy wrapper contexts retain their existing conservative resolver;
    // an explicit Node + CLI pair must not certify another runtime's config.
    return index!==1||effectiveExecutable(root,base[0],nativeEnvironment(config))===fs.realpathSync(process.execPath)&&canonicalVitestCLI(root,base[1])!==null;
  }catch{return false;}
}
function canonicalVitestCLI(root,requested) {
  if(!path.isAbsolute(requested)&&!requested.includes(path.sep))return null;
  try {
    const cli=fs.realpathSync(path.resolve(root,requested));
    readNativeIdentityFile(cli,256); // Reject FIFOs/devices/oversize before package lookup.
    // resolve.paths computes search directories without loading package JSON.
    // Node's self-resolution/export machinery is invoked only in the bounded
    // child after this conservative metadata/bin agreement succeeds.
    for(const directory of createRequire(cli).resolve.paths('vitest/package.json')||[]) {
      const metadata=path.join(directory,'vitest/package.json');
      try{fs.lstatSync(metadata);}catch(error){if(error.code==='ENOENT')continue;return null;}
      const pkg=JSON.parse(readNativeIdentityFile(metadata).toString('utf8'));
      const target=typeof pkg.bin==='object'&&pkg.bin?.vitest;
      if(pkg.name!=='vitest'||typeof target!=='string'||pkg.exports?.['./package.json']!=='./package.json'||fs.realpathSync(path.resolve(path.dirname(metadata),target))!==cli)return null;
      return {cli,version:pkg.version};
    }
    return null;
  }catch{return null;}
}
function readNativeIdentityFile(file,limit=1024*1024) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  try {
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size>1024*1024)throw new Error('Unbounded or nonregular native identity');
    const bytes=Buffer.alloc(Math.min(before.size,limit));let offset=0;
    while(offset<bytes.length) {
      const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);
      if(!count)throw new Error('Native identity truncated during read');offset+=count;
    }
    const after=fs.fstatSync(fd);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('Native identity changed during read');
    return bytes;
  }finally{fs.closeSync(fd);}
}
export function sharedVitestCommand(root,config) {
  if(adapterFor(config)!=='vitest')return null;
  let base;try{base=frameworkBase(commandBase(config,'vitest',root),'vitest');}catch{return null;}
  const index=base.findIndex(arg=>/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
  // A direct CLI shebang could select another interpreter. Bind an explicit
  // Node + CLI pair; PATH lookup follows the configured child's cwd and env.
  if(index!==1)return null;
  try {if(effectiveExecutable(root,base[0],nativeEnvironment(config))!==fs.realpathSync(process.execPath))return null;}catch{return null;}
  // Match the explicitly selected CLI installation, not an unrelated project
  // package or an unresolved executable somewhere on PATH.
  if(!path.isAbsolute(base[index])&&!base[index].includes(path.sep))return null;
  const selected=canonicalVitestCLI(root,base[index]);if(!selected)return null;
  base=[...base];base[0]=process.execPath;base[index]=selected.cli;
  const valued=new Set(['--config','-c','--mode','--maxWorkers','--minWorkers','--pool','--project']);
  const switches=new Set(['--no-file-parallelism','--passWithNoTests','--cache=false']);
  for(let i=index+1;i<base.length;i++) {
    const option=base[i].split('=')[0];
    if(valued.has(option)) {if(!base[i].includes('=')){if(!base[i+1]||base[i+1].startsWith('-'))return null;i++;}}
    else if(!switches.has(base[i]))return null;
  }
  try {
    return /^(?:4\.1\.|5\.)/.test(selected.version)?base:null;
  }catch{return null;}
}

/** Compatibility lookup. Graph construction uses the batched API. */
export function resolveNative(root, file, specifier, config = {}) {
  return resolveNativeBatch(root, [{file,specifier}], config).resolutions[0]?.paths?.[0] || null;
}

/** Internal shared JSON normalization: unified runs retain legacy case identities. */
export function normalizeUnifiedExecution(root, files, value, details) {
  const normalized=frameworkResults(root,value);
  const missingFiles=files.filter(file=>!normalized.collectionFiles.includes(file));
  const unknownFiles=normalized.collectionFiles.filter(file=>!files.includes(file));
  const complete=normalized.valid&&!missingFiles.length&&!unknownFiles.length&&!normalized.errors.length&&!details.signal&&[0,1].includes(details.nativeExitCode);
  const tests=identities(normalized.tests);
  const exitCode=complete?(tests.some(test=>test.status==='failed')?1:details.nativeExitCode):2;
  return {adapter:'vitest',...details,tests,collectionFiles:normalized.collectionFiles,requestedFiles:files,executedFiles:files,missingFiles,unknownFiles,dependencyFiles:[],complete,exitCode,reportErrors:normalized.errors};
}
