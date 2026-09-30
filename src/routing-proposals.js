import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { buildGraph, evidencePath } from './graph.js';
import { snapshot, digest } from './provenance.js';
import { safePath, readConfig } from './files.js';

/** Review-only candidates. A literal path does not certify all possible runtime inputs. */
export function routingProposals(root) {
  root=path.resolve(root);
  const config=readConfig(root);
  const before=snapshot(root,config);
  const graph=buildGraph(root);
  const proposals=[];
  for(const [file,text] of Object.entries(graph.sources)) {
    const consumers=graph.tests.filter(test=>test===file || evidencePath(graph,test,file));
    if(!consumers.length)continue;
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    if(ast.parseDiagnostics.length)continue;
    const inputs=new Map();
    function visit(node) {
      if(ts.isCallExpression(node) && /(?:^|\.)(?:readFile|readFileSync|createReadStream|readdir|readdirSync|stat|statSync|access|accessSync)$/.test(node.expression.getText(ast))) {
        const arg=node.arguments[0];
        let input,kind;
        if(arg && ts.isStringLiteralLike(arg)){input=arg.text;kind='literal-cwd-path';}
        if(arg && ts.isNewExpression(arg) && arg.expression.getText(ast)==='URL' && arg.arguments?.length===2 && ts.isStringLiteralLike(arg.arguments[0]) && arg.arguments[1].getText(ast)==='import.meta.url') {
          input=path.posix.join(path.posix.dirname(file),arg.arguments[0].text);kind='literal-module-url';
        }
        if(input && !path.isAbsolute(input) && !input.includes('\\') && !input.split('/').includes('..')) {
          try { if(fs.statSync(safePath(root,input)).isFile() && graph.files.includes(input))inputs.set(input,kind); } catch {}
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(ast);
    for(const [input,kind] of inputs)proposals.push({id:digest({file,input,consumers}),source:file,input,tests:consumers,kind,patch:{dependencies:Object.fromEntries(consumers.map(test=>[test,[input]]))},status:'review-required',authority:'proposal-only',limitations:['A literal call may be unreachable or refer to another API with the same name.','Accepting this mapping adds an edge; it does not remove runtime uncertainty.']});
  }
  const after=snapshot(root,config);
  return {schemaVersion:1,applied:false,provenance:before,stable:before.fingerprint===after.fingerprint,proposals:proposals.slice(0,1000),truncated:proposals.length>1000,warnings:graph.warnings,unmappedChangesPolicy:'full-suite'};
}
