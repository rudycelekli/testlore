import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { discover as nativeDiscovery, resolveNativeBatch } from './execution.js';
import { declaredInputs } from './inputs.js';
import { SOURCE, TEST, listFiles, normalize, safePath, readConfig } from './files.js';

export function analyze(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  const warnings = [];
  if (ast.parseDiagnostics.length) warnings.push('parse-error');
  const add = node => {
    if (node && ts.isStringLiteralLike(node)) imports.add(node.text);
    else warnings.push('dynamic-dependency');
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require' || name === 'require.resolve') add(node.arguments[0]);
      if (['eval', 'Function', 'import.meta.glob', 'import.meta.globEager', 'require.context'].includes(name)) warnings.push('dynamic-dependency');
      if (name.endsWith('.register') || name === 'module.register') warnings.push('runtime-registration');
    }
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'Function') warnings.push('dynamic-dependency');
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const spec of imports) {
    if (/^(?:node:)?(?:fs|fs\/promises|vm|child_process|module)$/.test(spec)) warnings.push('runtime-dependency');
  }
  return { ast, imports: [...imports], warnings: [...new Set(warnings)] };
}

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

export function buildGraph(root) {
  const config = readConfig(root);
  const files = listFiles(root);
  const selected = files.filter(f => (config.testMatch ? config.testMatch.some(pattern => path.matchesGlob(f,pattern)) : TEST.test(f)) && !(config.testExclude || []).some(pattern => path.matchesGlob(f,pattern)));
  const graph = { files, tests: selected, edges: {}, warnings: [], sources: {}, root, config, discovery: {complete:true,method:'configured-static-conventions'} };
  if(config.discovery === 'native' || Array.isArray(config.discovery)) {
    const discovered = nativeDiscovery(root,config);
    graph.tests = discovered.files;
    graph.discovery = discovered;
    for(const file of discovered.files)if(!files.includes(file))graph.warnings.push({file,reason:'discovered-file-outside-graph'});
    if(!discovered.complete)graph.warnings.push({file:'discovery',reason:'incomplete-native-discovery'});
  }
  graph.configFiles = new Set();
  for (const file of configurationSeeds(root,config)) graph.configFiles.add(file);
  if(graph.configFiles.has('__external_runner_config__'))graph.warnings.push({file:'configuration',reason:'external-resolution-config'});
  graph.compilerOptions = compilerOptions(root,config,graph.warnings,graph.configFiles);
  graph.packageNames = new Set();
  const set = new Set(files);
  for (const file of files.filter(f => /(?:^|\/)package\.json$/.test(f))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(safePath(root,file),'utf8'));
      if(pkg.name)graph.packageNames.add(pkg.name);
    } catch { graph.warnings.push({file,reason:'invalid-package-json'}); }
  }
  for (const file of files.filter(f => SOURCE.test(f))) graph.sources[file] = fs.readFileSync(safePath(root,file),'utf8');
  addSources(graph,Object.entries(graph.sources),set);
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
  return graph;
}

// A single native config/server resolves all literal imports, including baseline edges.
export function addSources(graph, entries, files = new Set(graph.files)) {
  if(graph.root && (graph.config?.discovery === 'native' || Array.isArray(graph.config?.discovery))) {
    const imports = entries.flatMap(([file,text]) => analyze(file,text).imports.filter(specifier=>!isBuiltin(specifier)).map(specifier=>({file,specifier})));
    const batch = resolveNativeBatch(graph.root,imports,graph.config);
    if(batch.supported) {
      graph.nativeResolutions ||= new Map();
      imports.forEach((item,i)=>graph.nativeResolutions.set(JSON.stringify([item.file,item.specifier]),batch.resolutions[i]));
      for(const file of batch.configFiles) graph.configFiles.add(file);
      if(!batch.complete)graph.warnings.push({file:'configuration',reason:'incomplete-native-resolution'});
    }
  }
  for(const [file,text] of entries) addSource(graph,file,text,files);
}

export function addSource(graph, file, text, files = new Set(graph.files)) {
  const info = analyze(file, text);
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

function configurationSeeds(root,config) {
  const seeds = new Set();
  if(config.tsconfig)seeds.add(normalize(config.tsconfig));
  for(const file of listFiles(root)) if(/^(?:tsconfig\.json|jsconfig\.json|(?:vitest|vite|jest)\.config\.[cm]?[jt]s)$/.test(file))seeds.add(file);
  const argv=config.runner||[];
  for(let i=0;i<argv.length;i++) {
    let file;
    if(['--config','-c','--tsconfig'].includes(argv[i]))file=argv[i+1];
    else if(/^(?:--config|-c|--tsconfig)=/.test(argv[i]))file=argv[i].slice(argv[i].indexOf('=')+1);
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
  const resolved=ts.resolveModuleName(spec,path.join(graph.root,file),graph.compilerOptions||{},ts.sys).resolvedModule?.resolvedFileName;
  let unresolved = false;
  if(resolved) {
    try {
      const relative=normalize(path.relative(fs.realpathSync(graph.root),fs.realpathSync(resolved)));
      if(files.has(relative))paths.add(relative);
      else if(!relative.startsWith('../')&&!relative.split('/').includes('node_modules'))unresolved=true;
    }catch{unresolved=true;}
  }
  const native=graph.nativeResolutions?.get(JSON.stringify([file,spec]));
  if(resolved && /\.d\.[cm]?ts$/.test(resolved) && !native?.external && !native?.paths?.some(file=>!/\.d\.[cm]?ts$/.test(file)))unresolved=true;
  if(native) {
    for(const candidate of native.paths||[]) {if(files.has(candidate))paths.add(candidate);else unresolved=true;}
    // Static success cannot certify a native import whose context is unknown.
    unresolved ||= Boolean(native.unresolved);
    return {paths:[...paths],unresolved};
  }
  const isInternal=[...(graph.packageNames||[])].some(name=>spec===name||spec.startsWith(name+'/'));
  const matchesAlias=Object.keys(graph.compilerOptions?.paths||{}).some(pattern=>path.matchesGlob(spec,pattern));
  return {paths:[...paths],unresolved:unresolved||(!paths.size&&(isInternal||matchesAlias||direct.unresolved))};
}
