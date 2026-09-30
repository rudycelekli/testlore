import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
  const graph = { files, tests: files.filter(f => TEST.test(f)), edges: {}, warnings: [], sources: {} };
  const set = new Set(files);
  for (const file of files.filter(f => /(?:^|\/)tsconfig[^/]*\.json$/.test(f))) {
    const parsed = ts.parseConfigFileTextToJson(file, fs.readFileSync(safePath(root, file), 'utf8'));
    if (parsed.error || parsed.config?.compilerOptions?.paths || parsed.config?.compilerOptions?.baseUrl || parsed.config?.extends) graph.warnings.push({ file, reason: 'unsupported-tsconfig-resolution' });
  }
  for (const file of files.filter(f => /(?:^|\/)package\.json$/.test(f))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(safePath(root, file), 'utf8'));
      if (pkg.workspaces || pkg.imports || pkg.exports) graph.warnings.push({ file, reason: 'unsupported-package-resolution' });
    } catch { graph.warnings.push({ file, reason: 'invalid-package-json' }); }
  }
  for (const file of files.filter(f => SOURCE.test(f))) {
    const text = fs.readFileSync(safePath(root, file), 'utf8');
    graph.sources[file] = text;
    addSource(graph, file, text, set);
  }
  for (const [test, deps] of Object.entries(config.dependencies || {})) {
    if (!graph.tests.includes(test)) graph.warnings.push({ file: test, reason: 'unknown-mapped-test' });
    for (const dep of deps) {
      if (!set.has(dep)) graph.warnings.push({ file: dep, reason: 'missing-mapped-dependency' });
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
    const resolved = resolveImport(file, spec, files);
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
