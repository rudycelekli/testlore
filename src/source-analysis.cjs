const ts = require('typescript');

function analyze(file, text) {
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
      if (name === 'fetch' || name === 'globalThis.fetch' || name.endsWith('.fetch')) warnings.push('runtime-dependency');
      if (name.endsWith('.register') || name === 'module.register') warnings.push('runtime-registration');
    }
    if (ts.isNewExpression(node)) {
      const name=node.expression.getText(ast);
      if(name==='Function')warnings.push('dynamic-dependency');
      if(['Worker','SharedWorker','WebSocket','EventSource'].includes(name)|| /(?:^|\.)(?:Worker|SharedWorker|WebSocket|EventSource)$/.test(name))warnings.push('runtime-dependency');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const spec of imports) {
    if (/^(?:node:)?(?:fs|fs\/promises|vm|child_process|module|worker_threads|http|https|http2|net|tls|dns|dns\/promises|dgram|wasi)$/.test(spec)) warnings.push('runtime-dependency');
  }
  return { ast, imports: [...imports], warnings: [...new Set(warnings)] };
}

function configurationFlags(ast) {
  let argvDependent=false, projectPlugins=false;
  const visit=node=>{if(ts.isIdentifier(node)||ts.isStringLiteralLike(node)){if(['argv','execArgv'].includes(node.text))argvDependent=true;if(node.text==='plugins')projectPlugins=true;}ts.forEachChild(node,visit);};
  visit(ast);return {argvDependent,projectPlugins};
}
exports.analyze=analyze;
exports.configurationFlags=configurationFlags;
exports.typescriptVersion=ts.version;
