import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../graph.js';
import { isBuiltin } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
function sendBounded(message) {
  if(Buffer.byteLength(JSON.stringify(message))>32*1024*1024)throw new Error('Unified native IPC evidence exceeded 32 MiB');
  return new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
}
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { root, adapter, command, imports } = request;
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
const output = { resolutions: [], additionalResolutions: [], configFiles: [], complete: true };
function expand(file) {
  if(!request.transitive || expanded.has(file) || !file.startsWith(root+path.sep) || file.includes(path.sep+'node_modules'+path.sep) || !/\.[cm]?[jt]sx?$/.test(file))return;
  expanded.add(file);
  if(expanded.size>10000)throw new Error('Native graph exceeds bounded source traversal');
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(!fs.existsSync(file))return;
  const physical=fs.realpathSync(file);
  if(!physical.startsWith(root+path.sep) || physical!==file)throw new Error('Native graph source crosses an unsupported symlink boundary');
  if(fs.statSync(file).size>8*1024*1024)throw new Error('Native graph source exceeds bounded traversal input');
  for(const specifier of analyze(relative,fs.readFileSync(file,'utf8')).imports) {
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
function globals(config, keys) {
  for(const key of keys)for(const item of [config[key] || []].flat()) {
    if(typeof item!=='string')throw new Error('Unsupported global setup declaration');
    const file=path.resolve(root,item);output.configFiles.push(file);expand(file);
  }
}
function rejectArgvConfiguration(files) {
  for(const file of files) {
    if(!file.startsWith(root+path.sep)||file.includes(path.sep+'node_modules'+path.sep)||!fs.existsSync(file)||!/\.[cm]?[jt]sx?$/.test(file))continue;
    const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    let dependent=false;
    function visit(node) {
      if((ts.isIdentifier(node)||ts.isStringLiteralLike(node))&&['argv','execArgv'].includes(node.text))dependent=true;
      ts.forEachChild(node,visit);
    }
    visit(ast);if(dependent)throw new Error('runtime-argv-dependent-native-configuration');
  }
}

try {
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
    const unsupported = command.some(arg => /^(?:--(?:workspace|project|browser|root|configLoader|environment|no-isolate|isolate)|-r)(?:=|$)/.test(arg));
    if (unsupported) throw new Error('Unsupported native resolution context; use a full suite');
    let context, unifiedSpecs;
    if(request.discover) {
      if(!Array.isArray(request.invocation))throw new Error('Missing native invocation binding');
      process.argv=[...request.invocation];
      const index=command.findIndex(arg=>/(?:^|[/\\])vitest(?:\.mjs)?$/.test(arg));
      const requireCLI=createRequire(command[index]);
      const vitest=await import(pathToFileURL(requireCLI.resolve('vitest/node')).href);
      const version=JSON.parse(fs.readFileSync(requireCLI.resolve('vitest/package.json'),'utf8')).version;
      const parsed=vitest.parseCLI(['vitest',...command.slice(index+1)]);
      if(parsed.filter.length)throw new Error('Shared native planning does not accept positional scope filters');
      const options={...parsed.options,root,run:true,watch:false,...(request.unified?{reporters:['json'],outputFile:request.reportFile}: {})};
      if(/^4\.1\./.test(version))context=await vitest.createVitest('test',options,{logLevel:'silent'});
      else if(/^5\./.test(version))context=await vitest.createVitest(options,{logLevel:'silent'});
      else throw new Error('Unsupported shared native planning API version');
    }
    try {
    const vite = context ? null : await import(pathToFileURL(loadPath('vite')).href);
    let configFile = argument('--config', '-c');
    if (configFile) configFile = path.resolve(root, configFile);
    configFile ||= ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs', 'vitest.config.cts', 'vitest.config.cjs'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
    const mode = argument('--mode') || 'test';
    const loaded = context ? null : await vite.loadConfigFromFile({ command: 'serve', mode, isSsrBuild: false, isPreview: false }, configFile, root, 'silent');
    const base = context ? { ...context.vite.config, test:context.getRootProject().config } : loaded?.config || {};
    if (base.test?.isolate === false) throw new Error('Shared test isolation requires a full suite');
    if (base.test?.projects?.length || base.test?.browser?.enabled || base.test?.workspace || base.root && path.resolve(root,base.root)!==root || base.test?.environment && !['node','jsdom','happy-dom'].includes(base.test.environment)) throw new Error('Multiple projects/browser resolution requires a native project graph');
    if(context && (context.projects.length!==1||context.projects[0]!==context.getRootProject()))throw new Error('Shared native planning requires one root project');
    globals(base.test || {},['setupFiles','globalSetup']);
    if(context) {
      const specs=await context.getRelevantTestSpecifications([]);
      if(request.unified)unifiedSpecs=specs;
      output.discovery={files:[...new Set(specs.map(spec=>spec.moduleId))],complete:true};
      for(const file of output.discovery.files)expand(file);
    }
    for(const file of request.roots || [])expand(path.resolve(root,file));
    output.configFiles.push(...(loaded?.dependencies || []), ...(loaded?.path ? [loaded.path] : []));
    if(context)output.configFiles.push(...(context.vite.config.configFileDependencies||[]),...(context.vite.config.configFile?[context.vite.config.configFile]:[]));
    rejectArgvConfiguration(output.configFiles);
    const aliases = value => Array.isArray(value) ? value : Object.entries(value || {}).map(([find, replacement]) => ({ find, replacement }));
    const server = context ? context.vite : await vite.createServer({ ...base, root, mode, configFile: false, logLevel: 'silent', server: { ...base.server, middlewareMode: true, watch: null }, resolve: { ...base.resolve, alias: [...aliases(base.test?.alias), ...aliases(base.resolve?.alias)] } });
    try {
      for (let index=0;index<queue.length;index++) {
        const { file, specifier } = queue[index];
        const resolved = [];
        // Preserve both client and SSR possibilities instead of guessing package conditions.
        for (const ssr of [false, true]) {
          const container = ssr && server.environments?.ssr?.pluginContainer || server.pluginContainer;
          resolved.push((await container.resolveId(specifier, path.resolve(root, file), { ssr }))?.id?.split('?')[0]);
        }
        record(resolution(resolved),queue[index],index);
      }
    } finally { if(!context)await server.close(); }
    if(request.unified) {
      if(!process.send)throw new Error('Missing unified native IPC channel');
      await sendBounded({phase:'planned',value:output});
      const instruction=await new Promise((resolve,reject)=>{
        process.once('message',resolve);process.once('disconnect',()=>reject(new Error('Unified controller disconnected')));
      });
      if(instruction.phase!=='execute'||!Array.isArray(instruction.files)||instruction.files.length>10000||instruction.files.some(file=>typeof file!=='string'))throw new Error('Invalid unified execution request');
      const expected=new Set(instruction.files.map(file=>path.resolve(root,file)));
      const specs=unifiedSpecs;
      const selected=specs.filter(spec=>expected.has(spec.moduleId));
      if(expected.size!==selected.length)throw new Error('Unified requested specifications are missing or duplicated');
      if(typeof context.standalone==='function')await context.standalone();else await context.init();
      const result=await context.runTestSpecifications(selected,selected.length===specs.length);
      if(result.unhandledErrors?.length)throw new Error('Unified native execution has unhandled errors');
      const stat=fs.lstatSync(request.reportFile);if(!stat.isFile()||stat.size>32*1024*1024)throw new Error('Unbounded unified native report');
      const value=JSON.parse(fs.readFileSync(request.reportFile,'utf8'));
      await sendBounded({phase:'executed',value});
    }
    } finally {if(context)await context.close();}
  }
} catch (error) {
  output.complete = false; output.error = error.message;
  output.additionalResolutions = [];
  output.resolutions = imports.map(() => ({ paths: [], unresolved: true }));
}
if(request.unified){if(!output.complete&&process.connected)process.send({phase:'failed',error:output.error});if(process.connected)process.disconnect();}else process.stdout.write(JSON.stringify(output));
