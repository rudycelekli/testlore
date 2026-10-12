import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {encodeNativeFrame,nativeFrameReader,readNativeJson} from '../native-protocol.js';
import {phaseTimings} from '../timing.js';
import {createNativeResolutionPass} from '../native-resolution-targets.js';
import {nativeSourceSummaryReader} from '../native-source-summaries.js';
import {captureConfigurationInputs,assertConfigurationInputFreshness,admitsCanonicalTempDirectory} from '../configuration-inputs.js';
import {captureVitestWorkspaceRoot,assertVitestWorkspaceRoot} from '../native-workspace-root.js';
import {captureNativeVitestCases,assertNativeVitestCases,captureNativeCaseConfiguration,assertNativeCaseConfiguration} from '../native-vitest-cases.js';
import {createVitestRegistrationPlugin,isReviewedUnimportFactoryPlugin,vitestCaseHash} from '../vitest-case-contracts.js';
import TestLoreVitestCaseReporter from './vitest-cases.js';
import {captureReaObservation,assertReaObservation,createReaObservationPlugin,createReaObservationReporter} from '../rea-observation.js';
const workerTiming=phaseTimings();
const argvSome=Array.prototype.some,argvStartsWith=String.prototype.startsWith,argvApply=Reflect.apply;
let protocolOutput, instruction;
function sendBounded(message) {
 const frame=encodeNativeFrame(message);
 return new Promise((resolve,reject)=>protocolOutput.write(frame,error=>error?reject(error):resolve()));
}
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { root, adapter, command, imports } = request;
const sourceSummary=nativeSourceSummaryReader(root,request.sourceSummaries,{requireBoundEngine:request.unified===true});
if(request.unified) {
 protocolOutput=fs.createWriteStream(null,{fd:4,autoClose:false});
 const input=fs.createReadStream(null,{fd:3,autoClose:false});
 instruction=new Promise((resolve,reject)=>{
  let received=false;const frames=nativeFrameReader({onError:reject,onFrame:value=>{if(received)return reject(new Error('Duplicate unified execution instruction'));received=true;resolve(value);}});
  input.on('data',bytes=>frames.push(bytes));input.once('end',()=>{frames.end();if(!received)reject(new Error('Unified controller disconnected'));});input.once('error',reject);
 });
 // Keep an early input-channel rejection observed until its execution await.
 instruction.catch(()=>{});
}

const queue = [...imports];
const seen = new Set(imports.map(item=>JSON.stringify([item.file,item.specifier])));
const expanded = new Set();
const initialLength = imports.length;
const requireProject = createRequire(path.join(root, 'package.json'));
function loadPath(name) {
  try { return requireProject.resolve(name); } catch {}
  for (const argument of command) if (path.isAbsolute(argument) && fs.existsSync(argument)) {
    try { return createRequire(argument).resolve(name); } catch {}
  }
  throw new Error(`Install ${name} locally or specify its absolute runner CLI`);
}
function argument(name, short) {
  for (let i = 0; i < command.length; i++) {
    if (command[i] === name || command[i] === short) return command[i + 1];
    if (command[i].startsWith(name + '=') || short && command[i].startsWith(short + '=')) return command[i].slice(command[i].indexOf('=') + 1);
  }
}
function resolution(paths) {
  const found = [...new Set(paths.filter(Boolean))];
  const local = found.filter(file => path.isAbsolute(file) && !file.includes(`${path.sep}node_modules${path.sep}`) && file.startsWith(root + path.sep));
  return { paths: local, external: found.length > 0 && local.length === 0, unresolved: found.length === 0 };
}
const output = { resolutions: [], additionalResolutions: [], configFiles: [], complete: true, sourceSummaryReuse:sourceSummary.stats };
function expand(file) {
  if(!request.transitive || expanded.has(file) || !file.startsWith(root+path.sep) || file.includes(path.sep+'node_modules'+path.sep) || !/\.[cm]?[jt]sx?$/.test(file))return;
  expanded.add(file);
  if(expanded.size>10000)throw new Error('Native graph exceeds bounded source traversal');
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(!fs.existsSync(file))return;
  const physical=fs.realpathSync(file);
  if(!physical.startsWith(root+path.sep) || physical!==file)throw new Error('Native graph source crosses an unsupported symlink boundary');
  if(fs.statSync(file).size>8*1024*1024)throw new Error('Native graph source exceeds bounded traversal input');
  for(const specifier of sourceSummary.read(relative,fs.readFileSync(file)).imports) {
    const key=JSON.stringify([relative,specifier]);
    if(isBuiltin(specifier) || seen.has(key))continue;
    if(queue.length>=50000)throw new Error('Native graph exceeds bounded import traversal');
    seen.add(key);queue.push({file:relative,specifier});
  }
}
function record(result, item, index) {
  if(index<initialLength)output.resolutions.push(result);
  else output.additionalResolutions.push({...item,resolution:result});
  for(const file of result.paths || [])expand(file);
}
function globals(config, keys, baseRoot=root) {
  for(const key of keys)for(const item of [config[key] || []].flat()) {
    if(typeof item!=='string')throw new Error('Unsupported global setup declaration');
    const file=path.resolve(baseRoot,item);output.configFiles.push(file);expand(file);
  }
}
function rejectArgvConfiguration(files) {
  const summaries=[];
  for(const file of files) {
    if(!file.startsWith(root+path.sep)||file.includes(path.sep+'node_modules'+path.sep)||!fs.existsSync(file)||!/\.[cm]?[jt]sx?$/.test(file))continue;
    const relative=path.relative(root,file).split(path.sep).join('/');
    const summary=sourceSummary.read(relative,fs.readFileSync(file));summaries.push(summary);
    const prefixes=summary.argvPrefixChecks||[];
    // Narrow finite checks used by REA: coverage and shard mode are disabled in
    // every admitted invocation. Unknown argv use remains unqualified.
    const argv=[process.argv,request.command,request.invocation].filter(Array.isArray);
    if(summary.argvDependent||prefixes.length&&(Array.prototype.some!==argvSome||String.prototype.startsWith!==argvStartsWith||Reflect.apply!==argvApply)||argvApply(argvSome,prefixes,[prefix=>!['--coverage','--shard='].includes(prefix)||argvApply(argvSome,argv,[args=>argvApply(argvSome,args,[arg=>typeof arg==='string'&&argvApply(argvStartsWith,arg,[prefix])])])]))throw new Error('runtime-argv-dependent-native-configuration');
  }
  if(argvApply(argvSome,summaries,[summary=>summary.argvPrefixChecks?.length])&&argvApply(argvSome,summaries,[summary=>summary.argvIntrinsicMutation]))throw new Error('runtime-argv-dependent-native-configuration');
}

function rejectUnifiedProjectPlugins(files,plugins,trustedPlugins=new Set(),observationalProfile=null) {
  // This prototype has not established stateful user-plugin planning/run parity.
  // Reject both observed configuration declarations and unknown resolved plugins.
  for(const file of files) {
    if(!file.startsWith(root+path.sep)||file.includes(path.sep+'node_modules'+path.sep)||!fs.existsSync(file)||!/\.[cm]?[jt]sx?$/.test(file))continue;
    const relative=path.relative(root,file).split(path.sep).join('/');
    if(sourceSummary.read(relative,fs.readFileSync(file)).projectPlugins&&!(observationalProfile?.observerConfiguration?.file===relative&&observationalProfile.observerConfiguration.sha256===vitestCaseHash(fs.readFileSync(file))))throw new Error('Unified native prototype does not support project plugins; verify with the legacy native full run');
  }
  const known=new Set(['vite:optimized-deps','vite:watch-package-data','vite:pre-alias','alias','vitest:capture-raw-test-config','vitest:config:cli','vitest:config','vitest:css-disable','vitest:resolve-core','vitest:resolve-root','vitest:project','vitest:meta-env-replacer','vitest:ssr-module-runner-fixer','vitest:browser:loader','vite:modulepreload-polyfill','vite:resolve-dev','vite:resolve-builtin:get-environment','vite:resolve-builtin','vite:html-inline-proxy','vite:css','builtin:oxc-runtime','vite:oxc','builtin:vite-json','vite:wasm-helper','vite:worker','vite:asset','vite:forward-console','vitest:test-config','vitest:config:server-defaults','vitest:environments-module-runner','vite:define','vite:css-post','vite:build-html','vite:worker-import-meta-url','vite:asset-import-meta-url','vite:dynamic-import-vars','vite:import-glob','vitest:config:server','vitest:config:append','vitest:css-empty-post','vitest:mocks','vitest:automock','vitest:coverage-transform','vitest:normalize-url','vitest:ui-injector','vitest:browser:loader:post','vite:client-inject','vite:bundled-dev-client-imports','vite:css-analysis','vite:import-analysis','vitest','vite:resolve','vite:esbuild','vite:json','vitest:normalize-optimizer','vite:wasm-fallback']);
  const unknown=Array.isArray(plugins)?plugins.filter(plugin=>!trustedPlugins.has(plugin)&&!(observationalProfile?.observerConfiguration&&isReviewedUnimportFactoryPlugin(plugin,observationalProfile.projectRoot,observationalProfile.registrationContracts[0]))&&(typeof plugin?.name!=='string'||!known.has(plugin.name))):null;
  if(!unknown||unknown.length){const names=unknown?.slice(0,5).map(plugin=>typeof plugin?.name==='string'?plugin.name.slice(0,80):'<unnamed>');throw new Error('Unified native prototype encountered an unqualified resolved plugin'+(names?': '+JSON.stringify(names):' inventory')+'; use the legacy native full run');}
}

try {
  if(request.nativeCwd!==undefined&&(!request.discover||adapter!=='vitest'))throw Error('Explicit native cwd requires a fresh shared Vitest discovery context');
  const workspacePolicy={nativeCwd:request.nativeCwd};
  const workspaceRoot=request.discover?captureVitestWorkspaceRoot(root,command,workspacePolicy):null;
  if(request.discover)assertVitestWorkspaceRoot(request.workspaceRoot??null,workspaceRoot);
  output.workspaceRoot=workspaceRoot;
  const casePolicy={vitestCases:request.vitestCases?.profile};
  const vitestCases=request.vitestCases?captureNativeVitestCases(root,casePolicy,command):null;
  assertNativeVitestCases(request.vitestCases??null,vitestCases);
  output.vitestCases=vitestCases;
  const reaPolicy=request.reaObservation?{reaObservation:request.reaObservation.profile,executionMode:'shadow'}:{};
  const reaObservation=request.reaObservation?captureReaObservation(root,reaPolicy,command):null;
  assertReaObservation(request.reaObservation??null,reaObservation);
  if(reaObservation&&(!request.unified||vitestCases))throw Error('REA observation requires its fresh shadow-only native session');
  output.reaObservation=reaObservation;
  let reaReporter;
  const freshReaObservation=()=>{if(reaObservation)assertReaObservation(reaObservation,captureReaObservation(root,reaPolicy,command));};
  let caseReporter,nativeCaseConfigurationInputs,caseRuntime;
  const trustedCasePlugins=new Set();
  function freshNativeCases(){if(vitestCases){
    assertNativeVitestCases(vitestCases,captureNativeVitestCases(root,casePolicy,command));
    if(nativeCaseConfigurationInputs)assertNativeCaseConfiguration(root,nativeCaseConfigurationInputs);
    if(caseRuntime){
      const projects=workspaceClosed?caseRuntime.projects:workspaceContext.projects;
      const globalConfig=workspaceClosed?caseRuntime.globalConfig:workspaceContext.config;
      if(projects.length!==1||projects[0].config.name!==(vitestCases.profile.profile==='unimport-detect-factory-runtime-v1'?'':'unit')||projects[0].config.root!==vitestCases.projectRoot||(projects[0].config.includeTaskLocation??globalConfig.includeTaskLocation)!==true)throw Error('Native case effective unit context changed');
    }
  }freshReaObservation();}
  freshNativeCases();
  let workspaceContext,workspaceEffective,workspaceClosed=false,nativeArgvReflected=false;
  const boundNativeArgv=Array.isArray(request.invocation)?[...request.invocation]:null;
  function freshWorkspaceRoot(){
    if(workspaceRoot){
      if(fs.realpathSync(process.cwd())!==workspaceRoot.cwd)throw Error('Native workspace cwd changed');
      assertVitestWorkspaceRoot(workspaceRoot,captureVitestWorkspaceRoot(root,command,workspacePolicy));
      if(request.nativeCwd!==undefined&&nativeArgvReflected&&JSON.stringify(process.argv)!==JSON.stringify(boundNativeArgv))throw Error('Native workspace argv changed');
      if(workspaceContext){
        const viteConfig=workspaceClosed?workspaceEffective.viteConfig:workspaceContext.vite?.config;
        const projectConfig=workspaceClosed?workspaceEffective.projectConfig:workspaceContext.getRootProject()?.config;
        if(viteConfig?.root!==workspaceRoot.nativeRoot||projectConfig?.root!==workspaceRoot.nativeRoot||viteConfig?.configFile!==workspaceRoot.configFile)throw Error('Native workspace effective root/config differs from admitted invocation');
      }
    }
  }
  freshWorkspaceRoot();
  const configurationPolicy={configurationInputs:request.configurationInputs};
  const physicalInputs=captureConfigurationInputs(root,configurationPolicy);
  const expectedInputs=request.configurationInputObservations||{schemaVersion:1,profile:'exact-canonical-temp-directory',observations:[],warnings:[]};
  assertConfigurationInputFreshness(expectedInputs,physicalInputs);
  if(physicalInputs.observations.length){
    const {analyze,typescript:ts,assertCurrentEngine}=createRequire(import.meta.url)('../syntax-engine.cjs');
    assertCurrentEngine();
    for(const input of physicalInputs.observations)if(!admitsCanonicalTempDirectory(analyze(input.file,fs.readFileSync(path.join(root,input.file),'utf8')).ast,ts))throw Error('Configuration filesystem profile rejected in native worker');
  }
  function freshInputs(){const current=captureConfigurationInputs(root,configurationPolicy);assertConfigurationInputFreshness(physicalInputs,current,{allowCanonicalTmpdir:true});return current;}
  if (adapter === 'jest') {
    const result = spawnSync(command[0], [...command.slice(1), '--showConfig'], { cwd: root, encoding: 'utf8', env: process.env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Jest config resolution failed');
    const configs = JSON.parse(result.stdout).configs;
    const module = await import(pathToFileURL(loadPath('jest-resolve')).href);
    const Resolver = module.default.default || module.default;
    for(const config of configs)globals(config,['setupFiles','setupFilesAfterEnv','globalSetup','globalTeardown']);
    for(const file of request.roots || [])expand(path.resolve(root,file));
    for (let index=0;index<queue.length;index++) {
      const { file, specifier } = queue[index];
      const absolute = path.resolve(root, file);
      const matching = configs.length === 1 ? configs : configs.filter(c => (c.roots || [c.rootDir]).some(r => absolute.startsWith(r + path.sep)));
      if (matching.length !== 1) { record({ paths: [], unresolved: true },queue[index],index); continue; }
      const config = matching[0];
      let names = [specifier];
      for (const [pattern, replacements] of config.moduleNameMapper || []) {
        const regex = new RegExp(pattern);
        if (regex.test(specifier)) { names = (Array.isArray(replacements) ? replacements : [replacements]).map(r => specifier.replace(regex, r)); break; }
      }
      const configuredConditions = config.testEnvironmentOptions?.customExportConditions;
      const environmentConditions = configuredConditions || (config.testEnvironment.includes('jest-environment-node') ? ['node', 'node-addons'] : config.testEnvironment.includes('jest-environment-jsdom') ? ['browser'] : null);
      if (!environmentConditions) { record({ paths: [], unresolved: true },queue[index],index); output.complete = false; continue; }
      const resolved = [];
      for (const name of names) for (const kind of ['require', 'import']) {
        resolved.push(Resolver.findNodeModule(name, { basedir: path.dirname(absolute), extensions: config.moduleFileExtensions.map(x => '.' + x), moduleDirectory: config.moduleDirectories, paths: config.modulePaths, resolver: config.resolver, rootDir: config.rootDir, conditions: [kind, 'default', ...environmentConditions] }));
      }
      record(resolution(resolved),queue[index],index);
    }
  } else {
    // Match Vitest's config-loading environment, including CLI-supplied mode.
    process.env.TEST = 'true'; process.env.VITEST = 'true'; process.env.NODE_ENV ??= 'test';
    const unsupported = command.some(arg => /^(?:--(?:workspace|browser|configLoader|environment|no-isolate|isolate)|-r)(?:=|$)/.test(arg)) || !request.discover && command.some(arg=>/^--(?:project|root)(?:=|$)/.test(arg));
    if (unsupported) throw new Error('Unsupported native resolution context; use a full suite');
    let context, unifiedSpecs;
    if(request.discover) {
      if(!Array.isArray(request.invocation))throw new Error('Missing native invocation binding');
      process.argv=[...request.invocation];
      nativeArgvReflected=true;freshWorkspaceRoot();
      const index=command.findIndex(arg=>/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
      const requireCLI=createRequire(command[index]);
      workerTiming.mark('requestAndAdmission');
      const vitest=await import(pathToFileURL(requireCLI.resolve('vitest/node')).href);
      workerTiming.mark('frameworkImport');
      const runtimeBytes=fs.readFileSync(requireCLI.resolve('vitest/package.json'));
      const version=JSON.parse(runtimeBytes).version;
      if(reaObservation&&(version!==reaObservation.vitestVersion||vitestCaseHash(runtimeBytes)!==reaObservation.runtimeManifestSha256))throw Error('REA observed native runtime changed');
      if(vitestCases&&(version!==vitestCases.vitestVersion||vitestCaseHash(runtimeBytes)!==vitestCases.runtimeManifestSha256))throw Error('Native case runtime differs from admitted project runtime');
      const parsed=vitest.parseCLI(['vitest',...command.slice(index+1)]);
      if(parsed.filter.length)throw new Error('Shared native planning does not accept positional scope filters');
      // With no CLI root, let native configuration resolve it from the same
      // cwd as the CLI. Forcing inventoryRoot would hide an unsupported root
      // declared by executable config before the containment guard observes it.
      const casePlugins=vitestCases?vitestCases.registrationContracts.map(contract=>createVitestRegistrationPlugin(vitestCases.projectRoot,contract)):reaObservation?[createReaObservationPlugin(reaObservation)]:[];
      for(const plugin of casePlugins)trustedCasePlugins.add(plugin);
      if(reaObservation)reaReporter=createReaObservationReporter(reaObservation);
      if(vitestCases&&request.unified)caseReporter=new TestLoreVitestCaseReporter({schemaVersion:1,root:vitestCases.projectRoot,expectedFiles:vitestCases.expectedFiles,inputs:vitestCases.inputs,vitestVersion:version,reportFile:null,registrationContracts:vitestCases.registrationContracts,scope:'deferred'});
      const options={...parsed.options,...(workspaceRoot?{root:workspaceRoot.nativeRoot}:{}),run:true,watch:false,...(vitestCases||reaObservation?{includeTaskLocation:true}:{}),...(request.unified?{reporters:caseReporter?['json',caseReporter]:reaReporter?['json',reaReporter]:['json'],outputFile:request.reportFile}: {})};
      const overrides={logLevel:'silent',...(casePlugins.length?{plugins:casePlugins}:{})};
      if(/^4\.1\./.test(version))context=await vitest.createVitest('test',options,overrides);
      else if(/^5\./.test(version))context=await vitest.createVitest(options,overrides);
      else throw new Error('Unsupported shared native planning API version');
      workspaceContext=context;
      workspaceEffective={viteConfig:context.vite.config,projectConfig:context.getRootProject().config};
      freshWorkspaceRoot();
      workerTiming.mark('frameworkInitializationAndConfiguration');
    }
    try {
    const vite = context ? null : await import(pathToFileURL(loadPath('vite')).href);
    let configFile = argument('--config', '-c');
    if (configFile) configFile = path.resolve(root, configFile);
    configFile ||= ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs', 'vitest.config.cts', 'vitest.config.cjs'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
    const mode = argument('--mode') || 'test';
    const loaded = context ? null : await vite.loadConfigFromFile({ command: 'serve', mode, isSsrBuild: false, isPreview: false }, configFile, root, 'silent');
    const base = context ? { ...context.vite.config, test:context.getRootProject().config } : loaded?.config || {};
    if (!context && base.test?.isolate === false) throw new Error('Shared test isolation requires a fresh native project graph');
    if (!context && (base.test?.projects?.length || base.test?.workspace) || base.test?.browser?.enabled || base.root && path.resolve(root,base.root)!==(workspaceRoot?.nativeRoot||root) || base.test?.environment && !['node','jsdom','happy-dom'].includes(base.test.environment)) throw new Error('Unsupported projects/browser resolution requires a native project graph');
    const projects=context?context.projects:[];
    if(context && (!projects.length||projects.length>128))throw new Error('Missing or unbounded native project inventory');
    // Vitest serializes a project's undefined value from the global CLI option.
    if(vitestCases&&(projects.length!==1||projects[0].config.name!==(vitestCases.profile.profile==='unimport-detect-factory-runtime-v1'?'':'unit')||(projects[0].config.includeTaskLocation??context.config.includeTaskLocation)!==true))throw Error('Reviewed native case profile requires the unit project and native task locations');
    if(vitestCases&&[...trustedCasePlugins].some(plugin=>!projects[0].vite.config.plugins.includes(plugin)))throw Error('Native unit project did not retain the exact reviewed observer plugin');
    if(reaObservation&&(projects.map(project=>project.config.name).sort().join(',')!=='adapters,domain,services'||projects.some(project=>[...trustedCasePlugins].some(plugin=>!project.vite.config.plugins.includes(plugin))||(project.config.includeTaskLocation??context.config.includeTaskLocation)!==true)))throw Error('REA shadow profile requires original three projects and the exact internal observer');
    if(vitestCases){caseRuntime={projects:[...projects],globalConfig:context.config};freshNativeCases();}
    for(const project of projects) {
      const config=project.config;
      if(!config || typeof config.name!=='string' || typeof config.isolate!=='boolean' || config.browser?.enabled || !['node','jsdom','happy-dom'].includes(config.environment) || !['threads','forks'].includes(config.pool) || !project.vite)throw new Error('Unqualified native project runtime');
      if(path.resolve(config.root)!==root&&!path.resolve(config.root).startsWith(root+path.sep))throw new Error('Native project root is outside the observed repository');
    }
    // Root global setup can provide values across all projects. Setup files
    // belong to their resolved project and are attached to its test closures.
    globals(base.test || {},context?['globalSetup']:['setupFiles','globalSetup'],context?context.getRootProject().config.root:root);
    workerTiming.mark('contextAndGlobalInputs');
    if(context) {
      const specs=await context.getRelevantTestSpecifications([]);
      if(request.unified)unifiedSpecs=specs;
      output.discovery={files:[...new Set(specs.map(spec=>spec.moduleId))],complete:true};
      const memberships=new Set();
      output.projectContracts=projects.map(project=>{
        const files=specs.filter(spec=>spec.project===project).map(spec=>spec.moduleId);
        for(const file of files){if(memberships.has(file))throw new Error('Overlapping native project test files require project-aware case identities');memberships.add(file);}
        const setupFiles=[project.config.setupFiles||[]].flat();
        if(setupFiles.some(file=>typeof file!=='string'))throw new Error('Unsupported project setup declaration');
        const normalizedSetup=setupFiles.map(file=>path.resolve(project.config.root,file));
        if(project===context.getRootProject())output.configFiles.push(...normalizedSetup);
        for(const file of normalizedSetup)expand(file);
        globals(project.config,['globalSetup'],project.config.root);
        output.configFiles.push(...(project.vite.config.configFileDependencies||[]),...(project.vite.config.configFile?[project.vite.config.configFile]:[]));
        return {name:project.config.name,files,isolate:project.config.isolate,setupFiles:normalizedSetup};
      });
      if(memberships.size!==output.discovery.files.length)throw new Error('Incomplete native project specification membership');
      if(vitestCases){const actual=output.discovery.files.map(file=>path.relative(vitestCases.projectRoot,file).split(path.sep).join('/')).sort();if(JSON.stringify(actual)!==JSON.stringify(vitestCases.expectedFiles))throw Error('Native case discovered unit inventory differs from reviewed 174-file profile');}
      for(const file of output.discovery.files)expand(file);
    }
    workerTiming.mark('nativeDiscoveryAndDiscoveredSourceExpansion');
    for(const file of request.roots || [])expand(path.resolve(root,file));
    output.configFiles.push(...(loaded?.dependencies || []), ...(loaded?.path ? [loaded.path] : []));
    if(context)output.configFiles.push(...(context.vite.config.configFileDependencies||[]),...(context.vite.config.configFile?[context.vite.config.configFile]:[]));
    for(const input of physicalInputs.observations){
      if(!output.configFiles.includes(path.join(root,input.file)))throw Error('Approved configuration input is not a loaded config dependency');
      for(const project of new Set(context?[context.getRootProject(),...projects]:[])){
        const env=project.config.env||{};
        if(env.TMPDIR!==input.canonicalDirectory||env.TMP!==undefined&&env.TMP!==input.environment.TMP||env.TEMP!==undefined&&env.TEMP!==input.environment.TEMP)throw Error('Native project temp environment differs from admitted configuration input');
      }
    }
    output.configurationInputs=freshInputs();
    rejectArgvConfiguration(output.configFiles);
    if(vitestCases){nativeCaseConfigurationInputs=captureNativeCaseConfiguration(root,output.configFiles);output.nativeCaseConfigurationInputs=nativeCaseConfigurationInputs;freshNativeCases();}
    if(context)for(const project of new Set([context.getRootProject(),...projects]))rejectUnifiedProjectPlugins(output.configFiles,project.vite.config.plugins,trustedCasePlugins,vitestCases);
    workerTiming.mark('sourceExpansionAndConfigurationAdmission');
    const aliases = value => Array.isArray(value) ? value : Object.entries(value || {}).map(([find, replacement]) => ({ find, replacement }));
    const server = context ? context.vite : await vite.createServer({ ...base, root, mode, configFile: false, logLevel: 'silent', server: { ...base.server, middlewareMode: true, watch: null }, resolve: { ...base.resolve, alias: [...aliases(base.test?.alias), ...aliases(base.resolve?.alias)] } });
    let resolutionPass;
    try {
      resolutionPass=createNativeResolutionPass(()=>context?projects.map(project=>project.vite):[server]);
      for (let index=0;index<queue.length;index++) {
        const { file, specifier } = queue[index];
        const resolved = [];
        // Preserve both client and SSR possibilities instead of guessing package conditions.
        let missing=false;
        for(const response of await resolutionPass.resolve(specifier,path.resolve(root,file))) {
          const found=response?.id?.split('?')[0];
          if(!found)missing=true;
          resolved.push(found);
        }
        const result=resolution(resolved);
        // Any selected project that cannot resolve a literal import leaves its
        // consumer closure uncertain. Never let another project's alias hide it.
        if(missing)result.unresolved=true;
        record(result,queue[index],index);
      }
    } finally { if(resolutionPass)output.nativeResolutionDiagnostics=resolutionPass.diagnostics();if(!context)await server.close(); }
    workerTiming.mark('nativeImportResolution');
    if(request.unified) {
      freshWorkspaceRoot();
      freshNativeCases();
      const plannedTiming=workerTiming.finish();
      await sendBounded({phase:'planned',value:output,timings:plannedTiming});
      const selectedInstruction=await instruction;
      workerTiming.mark('parentPlanningAndProtocolWait');
      if(selectedInstruction.phase!=='execute'||!Array.isArray(selectedInstruction.files)||selectedInstruction.files.length>10000||selectedInstruction.files.some(file=>typeof file!=='string'))throw new Error('Invalid unified execution request');
      const expected=new Set(selectedInstruction.files.map(file=>path.resolve(root,file)));
      const specs=unifiedSpecs;
      const selected=specs.filter(spec=>expected.has(spec.moduleId));
      if(reaObservation&&selected.length!==specs.length)throw Error('REA observation cannot omit any discovered specification');
      if(expected.size!==new Set(selected.map(spec=>spec.moduleId)).size)throw new Error('Unified requested specifications are missing');
      for(const project of output.projectContracts)if(!project.isolate&&project.files.some(file=>expected.has(file))&&project.files.some(file=>!expected.has(file)))throw new Error('Unified execution omitted a shared-isolation project member');
      if(caseReporter)caseReporter.bindExecutionScope(selected.map(spec=>path.relative(vitestCases.projectRoot,spec.moduleId).split(path.sep).join('/')));
      freshWorkspaceRoot();
      freshNativeCases();
      if(typeof context.standalone==='function')await context.standalone();else await context.init();
      freshWorkspaceRoot();
      freshNativeCases();
      workerTiming.mark('runnerInitialization');
      freshInputs();
      freshWorkspaceRoot();
      freshNativeCases();
      const result=await context.runTestSpecifications(selected,selected.length===specs.length);
      workerTiming.mark('nativeTestsAndReporter');
      freshWorkspaceRoot();
      freshNativeCases();
      if(result.unhandledErrors?.length)throw new Error('Unified native execution has unhandled errors');
      const value=readNativeJson(request.reportFile);
      if(caseReporter){value.nativeCaseEvidence=caseReporter.capture();value.nativeCaseEvidenceBinding={profile:vitestCases,configurationInputs:nativeCaseConfigurationInputs};}
      if(reaReporter){value.reaObservationReceipt=reaReporter.receipt;value.reaObservationBinding=reaObservation;}
      value.configurationInputs=freshInputs();
      workerTiming.mark('nativeReportRead');
      await sendBounded({phase:'executed',value,timings:workerTiming.finish()});
    }
    } finally {if(context){try{freshWorkspaceRoot();}finally{await context.close();workspaceClosed=true;}}}
  }
  output.configurationInputs=freshInputs();
  freshWorkspaceRoot();
  freshNativeCases();
} catch (error) {
  output.complete = false; output.error = error.message;
  output.additionalResolutions = [];
  output.resolutions = imports.map(() => ({ paths: [], unresolved: true }));
}
if(request.unified){if(!output.complete)await sendBounded({phase:'failed',error:String(output.error||'Native session failed').slice(0,500)});protocolOutput.end();}else if(request.resolutionReportFile)fs.writeFileSync(request.resolutionReportFile,JSON.stringify(output));else process.stdout.write(JSON.stringify(output));
