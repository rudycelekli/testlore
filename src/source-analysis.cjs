const ts = require('typescript');

function analyze(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  // Syntax hints only. A transform can read or rewrite even a declaration-level
  // type import, so callers must not use these hints as omission authority.
  const runtimeImports = new Set();
  const warnings = [];
  const registrationCalls = [];
  if (ast.parseDiagnostics.length) warnings.push('parse-error');
  const add = (node, runtime = true) => {
    if (node && ts.isStringLiteralLike(node)) { imports.add(node.text); if(runtime)runtimeImports.add(node.text); }
    else warnings.push('dynamic-dependency');
  };
  function visit(node) {
    // Taking a registration method as a callback is still an unknown state or
    // loader capability. Its later invocation need not preserve the spelling.
    const referencedProperty=ts.isPropertyAccessExpression(node)?node.name.text:ts.isElementAccessExpression(node)&&node.argumentExpression&&ts.isStringLiteralLike(node.argumentExpression)?node.argumentExpression.text:null;
    if(['register','registerHooks'].includes(referencedProperty))warnings.push('runtime-registration');
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // Inline `import { type X }` can retain an empty side-effect import under
      // verbatimModuleSyntax; only the whole declaration supplies a type hint.
      const typeOnly=ts.isImportDeclaration(node)?node.importClause?.isTypeOnly===true:node.isTypeOnly===true;
      if (node.moduleSpecifier) add(node.moduleSpecifier,!typeOnly);
      // A loader capability can escape through aliases, callbacks or reexports.
      // Named imports of unrelated module helpers do not grant that capability.
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && /^(?:node:)?module$/.test(node.moduleSpecifier.text)) {
        const bindings=ts.isImportDeclaration(node)?node.importClause?.namedBindings:node.exportClause;
        const wholeModule=ts.isImportDeclaration(node)?Boolean(node.importClause?.name || (bindings&&ts.isNamespaceImport(bindings))):!bindings || !ts.isNamedExports(bindings);
        if(wholeModule || (bindings && (ts.isNamedImports(bindings)||ts.isNamedExports(bindings)) && bindings.elements.some(element=>['register','registerHooks'].includes((element.propertyName||element.name).text))))warnings.push('runtime-registration');
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression,node.isTypeOnly!==true);
      if(node.moduleReference.expression&&ts.isStringLiteralLike(node.moduleReference.expression)&&/^(?:node:)?module$/.test(node.moduleReference.expression.text))warnings.push('runtime-registration');
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require' || name === 'require.resolve') add(node.arguments[0]);
      if((node.expression.kind===ts.SyntaxKind.ImportKeyword||name==='require') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && /^(?:node:)?module$/.test(node.arguments[0].text)) {
        const parent=node.parent;
        const unrelatedDestructure=ts.isVariableDeclaration(parent)&&ts.isObjectBindingPattern(parent.name)&&parent.name.elements.every(element=>!element.dotDotDotToken&&ts.isIdentifier(element.name)&&!element.initializer&&ts.isIdentifier(element.propertyName||element.name)&&!['register','registerHooks'].includes((element.propertyName||element.name).text));
        if(!unrelatedDestructure)warnings.push('runtime-registration');
      }
      if (['eval', 'Function', 'import.meta.glob', 'import.meta.globEager', 'require.context'].includes(name)) warnings.push('dynamic-dependency');
      if (name === 'fetch' || name === 'globalThis.fetch' || name.endsWith('.fetch')) warnings.push('runtime-dependency');
      let expression=node.expression;
      while(ts.isParenthesizedExpression(expression)||ts.isNonNullExpression(expression)||ts.isAsExpression(expression)||ts.isTypeAssertionExpression(expression)||ts.isSatisfiesExpression(expression))expression=expression.expression;
      const property=ts.isPropertyAccessExpression(expression)?expression.name.text:ts.isElementAccessExpression(expression)&&expression.argumentExpression&&ts.isStringLiteralLike(expression.argumentExpression)?expression.argumentExpression.text:null;
      if(['register','registerHooks'].includes(property)||ts.isIdentifier(expression)&&['register','registerHooks'].includes(expression.text)) {
        warnings.push('runtime-registration');
        registrationCalls.push({start:node.getStart(ast),end:node.end,callee:name,method:property||expression.text});
      }
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
  return { ast, imports: [...imports], runtimeImports: [...runtimeImports], warnings: [...new Set(warnings)], registrationCalls };
}

function configurationFlags(ast) {
  let argvDependent=false, projectPlugins=false, argvIntrinsicMutation=false;
  const argvPrefixChecks=new Set(),allowedProcess=new Set();
  // Admit only a pure Boolean flag query whose value can be checked against
  // both invocations. Aliases, arbitrary callbacks and indexed reads retain
  // the existing conservative rejection.
  function prefixQuery(node){
    const some=node.parent,call=some?.parent;
    if(!ts.isPropertyAccessExpression(node)||node.questionDotToken||node.name.text!=='argv'||!ts.isIdentifier(node.expression)||node.expression.text!=='process')return null;
    if(!some||!ts.isPropertyAccessExpression(some)||some.questionDotToken||some.name.text!=='some'||!call||!ts.isCallExpression(call)||call.questionDotToken||call.expression!==some||call.arguments.length!==1)return null;
    const fn=call.arguments[0];
    if(!ts.isArrowFunction(fn)||fn.modifiers?.length||fn.parameters.length!==1)return null;
    const p=fn.parameters[0],body=fn.body;
    if(!ts.isIdentifier(p.name)||p.initializer||p.dotDotDotToken||!ts.isCallExpression(body)||body.questionDotToken||body.arguments.length!==1)return null;
    const access=body.expression,arg=body.arguments[0];
    if(!ts.isPropertyAccessExpression(access)||access.questionDotToken||access.name.text!=='startsWith'||!ts.isIdentifier(access.expression)||access.expression.text!==p.name.text||!ts.isStringLiteral(arg)||!/^--[A-Za-z][A-Za-z0-9-]*(?:=)?$/.test(arg.text))return null;
    allowedProcess.add(node.expression);return arg.text;
  }
  const collect=node=>{if(ts.isPropertyAccessExpression(node)&&node.name.text==='argv'){const prefix=prefixQuery(node);if(prefix)argvPrefixChecks.add(prefix);}ts.forEachChild(node,collect);};collect(ast);
  const visit=node=>{
    if(ts.isIdentifier(node)||ts.isStringLiteralLike(node)){
      if(['argv','execArgv'].includes(node.text)){
        if(node.text!=='argv'||!ts.isIdentifier(node)||!prefixQuery(node.parent))argvDependent=true;
      }
      // A local/aliased/mutated process binding makes the apparent query opaque.
      if(argvPrefixChecks.size&&ts.isIdentifier(node)&&node.text==='process'&&!allowedProcess.has(node)&&!(ts.isPropertyAccessExpression(node.parent)&&node.parent.expression===node&&!['argv','execArgv'].includes(node.parent.name.text)))argvDependent=true;
      if(node.text==='plugins')projectPlugins=true;
      if(['prototype','defineProperty','defineProperties','eval','Function','Reflect'].includes(node.text))argvIntrinsicMutation=true;
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);return {argvDependent,projectPlugins,argvIntrinsicMutation,argvPrefixChecks:[...argvPrefixChecks].sort()};
}
exports.analyze=analyze;
exports.configurationFlags=configurationFlags;
exports.typescriptVersion=ts.version;

exports.typescript=ts;
