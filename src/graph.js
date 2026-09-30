import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { discover as nativeDiscovery, resolveNative } from './execution.js';
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
  graph.compilerOptions = compilerOptions(root,config,graph.warnings);
  graph.packageNames = new Set();
  const set = new Set(files);
  for (const file of files.filter(f => /(?:^|\/)package\.json$/.test(f))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(safePath(root,file),'utf8'));
      if(pkg.name)graph.packageNames.add(pkg.name);
    } catch { graph.warnings.push({file,reason:'invalid-package-json'}); }
  }
  for (const file of files.filter(f => SOURCE.test(f))) {
    const text = fs.readFileSync(safePath(root, file), 'utf8');
    graph.sources[file] = text;
    addSource(graph, file, text, set);
  }
  const declared = declaredInputs(config);
  for (const [test,deps] of Object.entries(config.dependencies || {})) declared[test] = [...(declared[test]||[]),...deps];
  for (const [test, deps] of Object.entries(declared)) {
    if (!graph.tests.includes(test)) graph.warnings.push({ file: test, reason: 'unknown-mapped-test' });
    for (const dep of deps) {
      if (!dep.startsWith('service:') && !set.has(dep)) graph.warnings.push({ file: dep, reason: 'missing-mapped-dependency' });
      graph.edges[test] = [...new Set([...(graph.edges[test] || []), dep])];
    }
  }
  return graph;
}

export function addSource(graph, file, text, files = new Set(graph.files)) {
  const info = analyze(file, text);
  const edges = graph.edges[file] || [];
  for (const reason of info.warnings) graph.warnings.push({ file, reason });
  for (const spec of info.imports) {
    const resolved = resolveGraphImport(graph,file,spec,files);
    if (resolved.path) edges.push(resolved.path);
    else if (resolved.unresolved) graph.warnings.push({ file, reason: `unresolved-import:${spec}` });
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

function compilerOptions(root,config,warnings) {
  const filename=config.tsconfig ? safePath(root,config.tsconfig) : path.join(root,'tsconfig.json');
  if(!fs.existsSync(filename)) return {allowJs:true,resolveJsonModule:true,moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext};
  const read=ts.readConfigFile(filename,ts.sys.readFile);
  if(read.error){warnings.push({file:path.relative(root,filename),reason:'invalid-tsconfig'});return {};}
  const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,path.dirname(filename));
  if(parsed.errors.some(e=>e.code!==18003))warnings.push({file:path.relative(root,filename),reason:'invalid-tsconfig-resolution'});
  return {...parsed.options,allowJs:true};
}
function resolveGraphImport(graph,file,spec,files) {
  const direct=resolveImport(file,spec,files);
  if(direct.path)return direct;
  if(!graph.root)return direct;
  if(isBuiltin(spec))return {external:true};
  let resolved=ts.resolveModuleName(spec,path.join(graph.root,file),graph.compilerOptions||{},ts.sys).resolvedModule?.resolvedFileName;
  if(!resolved && (graph.config?.discovery==='native' || Array.isArray(graph.config?.discovery))) {
    try{resolved=resolveNative(graph.root,file,spec,graph.config);}catch{graph.warnings.push({file,reason:'native-resolver-failed'});}
  }

  if(resolved && typeof resolved==='object')resolved=resolved.path;
  if(resolved) {
    try {
      const absolute=fs.realpathSync(path.isAbsolute(resolved)?resolved:path.join(graph.root,resolved));
      const relative=normalize(path.relative(fs.realpathSync(graph.root),absolute));
      if(files.has(relative))return {path:relative};
      if(!relative.startsWith('../')&&!relative.split('/').includes('node_modules'))return {unresolved:true};
      return {external:true};
    }catch{return {unresolved:true};}
  }
  const isInternal=[...(graph.packageNames||[])].some(name=>spec===name||spec.startsWith(name+'/'));
  const matchesAlias = Object.keys(graph.compilerOptions?.paths || {}).some(pattern => path.matchesGlob(spec,pattern));
  if(isInternal || matchesAlias || (direct.external && (graph.config?.discovery==='native'||Array.isArray(graph.config?.discovery))))return {unresolved:true};
  return direct;
}
