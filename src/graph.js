import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAnalysisCache, ANALYSIS_CACHE_IMPLEMENTATION } from './graph-cache.js';
import { discover as nativeDiscovery, resolveNativeBatch, combinedNativePlanningSupported } from './execution.js';
import { sessionPlanning } from './native-session.js';
import { declaredInputs } from './inputs.js';
import { phaseTimings } from './timing.js';
import { SOURCE, TEST, listFiles, normalize, safePath, readConfig } from './files.js';

import {analyze,typescript as ts,loadedIdentity,assertCurrentEngine,optimizationAvailable} from './syntax-engine.cjs';
export {analyze};

const ANALYSIS_ENGINE = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, typescript: ts.version, node: process.version, graph: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), syntaxEngine: loadedIdentity, cache: ANALYSIS_CACHE_IMPLEMENTATION })).digest('hex');
const SUMMARY_CACHE = Symbol('sourceAnalysisCache');
const RESOLUTION_CACHE = Symbol('planningModuleResolutionCache');
function summaries(graph) {
  assertCurrentEngine();
  if (!graph[SUMMARY_CACHE]) {
    graph[SUMMARY_CACHE] = createAnalysisCache(graph.root, optimizationAvailable?graph.config?.analysisCache:{enabled:false}, ANALYSIS_ENGINE);
    graph.analysisCache = graph[SUMMARY_CACHE].stats;
  }
  return graph[SUMMARY_CACHE];
}
function sourceSummary(graph, file, text) { return summaries(graph).analyze(file, text, analyze); }

export function resolveImport(file, spec, files) {
  if (!spec.startsWith('.')) return { external: !spec.startsWith('#') && !spec.startsWith('@/') && !spec.startsWith('~/'), unresolved: spec.startsWith('#') || spec.startsWith('@/') || spec.startsWith('~/') };
  const base = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
  if (base.startsWith('../')) return { unresolved: true };
  if (files.has(base)) return { path: base };
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mts`, `${base}.mjs`, `${base}.cts`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`];
  if (/\.[cm]?jsx?$/.test(base)) candidates.push(base.replace(/\.[cm]?jsx?$/, '.ts'), base.replace(/\.[cm]?jsx?$/, '.tsx'), base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts'));
  const found = [...new Set(candidates.filter(p => files.has(p)))];
  return found.length === 1 ? { path: found[0] } : { unresolved: true };
}

export function buildGraph(root, nativeSession) { return build(root,nativeSession); }
// Internal planner entrypoint; never sourced from public run/plan options.
export function buildPlanningGraph(root, nativeSession, config, files) { return build(root,nativeSession,{config,files}); }
function build(root, nativeSession, planningInputs) {
  const timing = phaseTimings();
  const config = planningInputs?.config ?? readConfig(root);
  const files = planningInputs?.files ?? listFiles(root);
  const selected = files.filter(f => (config.testMatch ? config.testMatch.some(pattern => path.matchesGlob(f,pattern)) : TEST.test(f)) && !(config.testExclude || []).some(pattern => path.matchesGlob(f,pattern)));
  const graph = { files, tests: selected, edges: {}, warnings: [], sources: {}, root, config, discovery: {complete:true,method:'configured-static-conventions'} };
  graph.configFiles = new Set();
  timing.mark('inventory');
  if(config.discovery === 'native' || Array.isArray(config.discovery)) {
    let combined, sharedAttempt;
    if(nativeSession) {
      combined=sessionPlanning(nativeSession,root);
      graph.nativePlanning={method:'fresh-unified-native-context',complete:true};
      graph.nativeResolutions=new Map(combined.additionalResolutions.map(item=>[JSON.stringify([item.file,item.specifier]),item.resolution]));
      for(const file of combined.configFiles)graph.configFiles.add(file);
    } else if(combinedNativePlanningSupported(root,config)) {
      combined=resolveNativeBatch(root,[],config,{discover:true,transitive:true,roots:[...configurationSeeds(root,config,files)]});
      sharedAttempt={complete:combined.complete,error:combined.error};
      // A failed shared context contributes no authority. Preserve fresh native
      // collection and the conservative legacy resolver path on failure.
      if(combined.complete&&combined.discovery?.complete) {
        graph.nativePlanning={method:'fresh-shared-native-context',complete:true};
        graph.nativeResolutions=new Map((combined.additionalResolutions||[]).map(item=>[JSON.stringify([item.file,item.specifier]),item.resolution]));
        for(const file of combined.configFiles)graph.configFiles.add(file);
      } else combined=null;
    }
    const discovered = combined?.discovery || nativeDiscovery(root,config);
    graph.tests = discovered.files;
    graph.discovery = {...discovered,...(sharedAttempt?{sharedContextAttempt:sharedAttempt}:{})};
    for(const file of discovered.files)if(!files.includes(file))graph.warnings.push({file,reason:'discovered-file-outside-graph'});
    if(!discovered.complete)graph.warnings.push({file:'discovery',reason:'incomplete-native-discovery'});
  }
  timing.mark('discovery');
  // NODE_OPTIONS is parsed by Node before our runner starts. Its quoting, inline
  // data URLs and package preloads are not an argv contract we can certify.
  const nodeOptions = config.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? '';
  if(nodeOptions.trim())graph.warnings.push({file:'configuration',reason:'unmodeled-node-options-runtime-context'});
  for (const file of configurationSeeds(root,config,files)) graph.configFiles.add(file);
  if(graph.configFiles.has('__external_runner_config__'))graph.warnings.push({file:'configuration',reason:'external-resolution-config'});
  graph.compilerOptions = compilerOptions(root,config,graph.warnings,graph.configFiles);
  // Resolution filesystem observations live only on this fresh graph, after
  // executable native configuration and JSON compiler options have been read.
  graph[RESOLUTION_CACHE] = ts.createModuleResolutionCache(root, name=>name, graph.compilerOptions);
  graph.packageNames = new Set();
  const set = new Set(files);
  for (const file of files.filter(f => /(?:^|\/)package\.json$/.test(f))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(safePath(root,file),'utf8'));
      if(pkg.name)graph.packageNames.add(pkg.name);
    } catch { graph.warnings.push({file,reason:'invalid-package-json'}); }
  }
  timing.mark('configuration');
  for (const file of files.filter(f => SOURCE.test(f))) graph.sources[file] = fs.readFileSync(safePath(root,file),'utf8');
  timing.mark('sourceReads');
  addSources(graph,Object.entries(graph.sources),set,{ roots: [...graph.tests,...graph.configFiles], resolved:graph.nativePlanning?.complete===true });
  timing.mark('sourceAnalysisAndResolution');
  const declared = declaredInputs(config);
  for (const [test,deps] of Object.entries(config.dependencies || {})) declared[test] = [...(declared[test]||[]),...deps];
  for (const [test, deps] of Object.entries(declared)) {
    if (!graph.tests.includes(test)) graph.warnings.push({ file: test, reason: 'unknown-mapped-test' });
    for (const dep of deps) {
      if (!dep.startsWith('service:') && !set.has(dep)) graph.warnings.push({ file: dep, reason: 'missing-mapped-dependency' });
      graph.edges[test] = [...new Set([...(graph.edges[test] || []), dep])];
    }
  }
  for(const file of [...graph.configFiles]) for(const dep of dependencies(graph,file)) graph.configFiles.add(dep);
  for(const file of graph.configFiles)if(!set.has(file))graph.warnings.push({file,reason:'resolution-config-outside-graph'});
  timing.mark('declaredInputsAndConfigurationClosure');
  classifyWarnings(graph);
  timing.mark('warningClassification');
  graph.timings = timing.finish();
  return graph;
}

// A single native config/server resolves all literal imports, including baseline edges.
export function addSources(graph, entries, files = new Set(graph.files), options = {}) {
  if(!options.resolved && graph.root && (graph.config?.discovery === 'native' || Array.isArray(graph.config?.discovery))) {
    const relevant = options.roots ? entries.filter(([file])=>options.roots.includes(file)) : entries;
    const imports = relevant.flatMap(([file,text]) => sourceSummary(graph,file,text).imports.filter(specifier=>!isBuiltin(specifier)).map(specifier=>({file,specifier})))
      .filter(({file,specifier}) => options.roots || graph.nativePlanning?.complete !== true || !graph.nativeResolutions?.has(JSON.stringify([file,specifier])));
    // Reuse only exact importer/specifier observations from this fresh planning
    // graph's complete native context. Historical imports absent from that
    // context still need native resolution; another importer is a different key.
    // A root pass must load native configuration even without missing imports.
    const batch = imports.length || options.roots
      ? resolveNativeBatch(graph.root,imports,graph.config,{ transitive: Boolean(options.roots), roots: options.roots })
      : { supported: false };
    if(batch.supported) {
      graph.nativeResolutions ||= new Map();
      imports.forEach((item,i)=>graph.nativeResolutions.set(JSON.stringify([item.file,item.specifier]),batch.resolutions[i]));
      for(const item of batch.additionalResolutions || [])graph.nativeResolutions.set(JSON.stringify([item.file,item.specifier]),item.resolution);
      for(const file of batch.configFiles) graph.configFiles.add(file);
      if(!batch.complete)graph.warnings.push({file:'configuration',reason:'incomplete-native-resolution'});
      if(batch.error==='runtime-argv-dependent-native-configuration')graph.discovery={...graph.discovery,complete:false,warnings:[...(graph.discovery.warnings||[]),'runtime-argv-dependent-native-configuration']};
    }
  }
  for(const [file,text] of entries) addSource(graph,file,text,files);
  summaries(graph).flush();
}

export function addSource(graph, file, text, files = new Set(graph.files)) {
  const info = sourceSummary(graph, file, text);
  const edges = graph.edges[file] || [];
  for (const reason of info.warnings) graph.warnings.push({ file, reason });
  for (const spec of info.imports) {
    const resolved = resolveGraphImport(graph,file,spec,files);
    edges.push(...(resolved.paths || (resolved.path ? [resolved.path] : [])));
    if (resolved.unresolved) graph.warnings.push({ file, reason: `unresolved-import:${spec}` });
  }
  graph.edges[file] = [...new Set(edges)].sort();
}

export function dependencies(graph, start) {
  const seen = new Set();
  function visit(file) {
    for (const dep of graph.edges[file] || []) {
      if (seen.has(dep) || dep === start) continue;
      seen.add(dep); visit(dep);
    }
  }
  visit(start);
  return [...seen].sort();
}

export function evidencePath(graph, start, target) {
  const queue = [[start]];
  const seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const chain = queue[i];
    if (chain.at(-1) === target) return chain;
    for (const dep of graph.edges[chain.at(-1)] || []) {
      if (!seen.has(dep)) { seen.add(dep); queue.push([...chain, dep]); }
    }
  }
  return null;
}

function configurationSeeds(root,config,files = listFiles(root)) {
  const seeds = new Set();
  if(config.tsconfig)seeds.add(normalize(config.tsconfig));
  for(const file of files) if(/^(?:pnpm-workspace\.yaml|tsconfig\.json|jsconfig\.json|(?:vitest|vite|jest|playwright)\.config\.[cm]?[jt]s)$/.test(file))seeds.add(file);
  const argv=config.runner||[];
  for(let i=0;i<argv.length;i++) {
    let file;
    if(['--config','-c','--tsconfig','--import','--require','-r','--loader','--experimental-loader'].includes(argv[i]))file=argv[i+1];
    else if(/^(?:--config|-c|--tsconfig|--import|--require|-r|--loader|--experimental-loader)=/.test(argv[i]))file=argv[i].slice(argv[i].indexOf('=')+1);
    if(file){const relative=normalize(path.relative(root,path.resolve(root,file)));if(relative.startsWith('../'))seeds.add('__external_runner_config__');else seeds.add(relative);}
  }
  return seeds;
}
function compilerOptions(root,config,warnings,configFiles) {
  const filename=config.tsconfig ? safePath(root,config.tsconfig) : path.join(root,'tsconfig.json');
  if(!fs.existsSync(filename)) return {allowJs:true,resolveJsonModule:true,moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext};
  const readFile = file => {
    const relative=normalize(path.relative(root,file));
    if(relative.startsWith('../'))warnings.push({file:relative,reason:'external-resolution-config'});
    else configFiles.add(relative);
    return ts.sys.readFile(file);
  };
  const read=ts.readConfigFile(filename,readFile);
  if(read.error){warnings.push({file:path.relative(root,filename),reason:'invalid-tsconfig'});return {};}
  const parsed=ts.parseJsonConfigFileContent(read.config,{...ts.sys,readFile},path.dirname(filename));
  if(parsed.errors.some(e=>e.code!==18003))warnings.push({file:path.relative(root,filename),reason:'invalid-tsconfig-resolution'});
  return {...parsed.options,allowJs:true};
}
function resolveGraphImport(graph,file,spec,files) {
  const direct=resolveImport(file,spec,files);
  if(isBuiltin(spec))return {external:true};
  if(!graph.root)return direct;
  const paths = new Set(direct.path ? [direct.path] : []);
  const module=ts.resolveModuleName(spec,path.join(graph.root,file),graph.compilerOptions||{},ts.sys,graph[RESOLUTION_CACHE]).resolvedModule;
  const resolved=module?.resolvedFileName;
  const isInternal=[...(graph.packageNames||[])].some(name=>spec===name||spec.startsWith(name+'/'));
  const matchesAlias=Object.keys(graph.compilerOptions?.paths||{}).some(pattern=>path.matchesGlob(spec,pattern));
  const native=graph.nativeResolutions?.get(JSON.stringify([file,spec]));
  // Package declarations describe external libraries, not a missing local runtime edge.
  // Internal exports and aliases still require a runtime-capable resolution.
  const externalDeclaration=!native && direct.external && module?.isExternalLibraryImport === true && !isInternal && !matchesAlias;
  let unresolved = false;
  if(resolved) {
    try {
      const relative=normalize(path.relative(fs.realpathSync(graph.root),fs.realpathSync(resolved)));
      if(files.has(relative))paths.add(relative);
      else if(!relative.startsWith('../')&&!relative.split('/').includes('node_modules'))unresolved=true;
    }catch{unresolved=true;}
  }
  if(resolved && /\.d\.[cm]?ts$/.test(resolved) && !externalDeclaration && !native?.external && !native?.paths?.some(file=>!/\.d\.[cm]?ts$/.test(file)))unresolved=true;
  if(native) {
    for(const candidate of native.paths||[]) {if(files.has(candidate))paths.add(candidate);else unresolved=true;}
    // Static success cannot certify a native import whose context is unknown.
    unresolved ||= Boolean(native.unresolved);
    return {paths:[...paths],unresolved};
  }
  return {paths:[...paths],unresolved:unresolved||(!paths.size&&(isInternal||matchesAlias||direct.unresolved))};
}

/** Unknown source edges retain their consumers on every change; global context is never scoped away. */
export function classifyWarnings(graph) {
  const globalReasons = new Set(['runtime-registration','incomplete-native-discovery','discovered-file-outside-graph','external-resolution-config','incomplete-native-resolution','invalid-tsconfig','invalid-tsconfig-resolution','invalid-package-json','unknown-mapped-test','missing-mapped-dependency','resolution-config-outside-graph']);
  const consumersBySource = new Map();
  for(const test of graph.tests)for(const file of [test,...dependencies(graph,test)]){
    const consumers=consumersBySource.get(file) || []; consumers.push(test);consumersBySource.set(file,consumers);
  }
  for(const warning of graph.warnings) {
    const consumers = consumersBySource.get(warning.file) || [];
    const configContext = graph.configFiles?.has(warning.file);
    const sourceContext = Object.hasOwn(graph.sources || {}, warning.file);
    warning.scope = globalReasons.has(warning.reason) || configContext || !sourceContext ? 'global' : consumers.length ? 'test-closure' : 'unreachable-source';
    warning.tests = warning.scope==='test-closure' ? consumers : [];
  }
  return graph.warnings;
}
