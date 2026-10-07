import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {typescript as ts} from './syntax-engine.cjs';
import {buildGraph, evidencePath} from './graph.js';
import {snapshot, digest, freshness} from './provenance.js';
import {safePath, readConfig, TEST} from './files.js';

const MAX_PROPOSALS=1000, MAX_INPUTS=1000, MAX_TESTS=1000, MAX_EDGES=25000, MAX_REFERENCE_BYTES=512*1024;
const implementation=()=>({module:'routing-proposals.js',sha256:digest(fs.readFileSync(fileURLToPath(import.meta.url)))});
const LIMITATIONS=[
  'Suggestions add dependency edges for review; they never remove graph uncertainty or establish complete inputs.',
  'Static literals and package declarations may be unreachable, shadowed, or resolved differently by native runtime configuration.',
  'Source and producer hashes bind inspected bytes, not installed dependencies, a truthful source map, or every external service state.'
];
function rejectProbes(config){if(Object.values(config.services||{}).some(service=>service?.probe!==undefined))throw new Error('Routing proposals cannot execute service probes; use fixed or environment-based service versions');}
function seal(payload){return {...payload,integrity:digest(payload)};}
function local(root,files,value,base=''){
  if(typeof value!=='string'||!value||/[\\\0%?#]/.test(value)||/^[a-z][a-z\d+.-]*:/i.test(value)||path.posix.isAbsolute(value))return null;
  const input=path.posix.normalize(path.posix.join(base,value));
  try{return files.has(input)&&fs.statSync(safePath(root,input)).isFile()?input:null;}catch{return null;}
}
function literal(node){return node&&ts.isStringLiteralLike(node)?node.text:null;}
function modulePath(node,ast,file){
  if(ts.isNewExpression(node)&&node.expression.getText(ast)==='URL'&&node.arguments?.length===2&&literal(node.arguments[0])!==null&&node.arguments[1].getText(ast)==='import.meta.url')return {value:literal(node.arguments[0]),base:path.posix.dirname(file),kind:'literal-module-url'};
  if(ts.isCallExpression(node)&&/^(?:path\.)?(?:join|resolve)$/.test(node.expression.getText(ast))&&node.arguments.length>=2&&node.arguments.length<=8&&['__dirname','import.meta.dirname'].includes(node.arguments[0].getText(ast))&&node.arguments.slice(1).every(arg=>literal(arg)!==null&&!path.posix.isAbsolute(literal(arg))))return {value:node.arguments.slice(1).map(literal).join('/'),base:path.posix.dirname(file),kind:'literal-module-directory'};
  return null;
}
function packageName(specifier){return specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];}
function imports(ast){
  const result=[];
  function visit(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&literal(node.moduleSpecifier)!==null)result.push(literal(node.moduleSpecifier));
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==='require')&&node.arguments.length===1&&literal(node.arguments[0])!==null)result.push(literal(node.arguments[0]));
    ts.forEachChild(node,visit);
  }
  visit(ast);return [...new Set(result)];
}
// This deliberately accepts only a bounded literal packages block, not general
// YAML. Aliases, tags, inline lists and multiline scalars need manual review.
function pnpmPatterns(root,files,warnings){
  if(!files.has('pnpm-workspace.yaml'))return null;
  const file=safePath(root,'pnpm-workspace.yaml');
  if(fs.statSync(file).size>64*1024){warnings.push({file:'pnpm-workspace.yaml',reason:'unsupported-workspace-declarations'});return null;}
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/),patterns=[];let block=false,found=false,invalid=false;
  for(const raw of lines){
    if(!raw.trim()||/^\s*#/.test(raw))continue;
    if(/^packages\s*:/.test(raw)){
      if(found||!/^packages\s*:\s*(?:#.*)?$/.test(raw)){invalid=true;break;}
      found=true;block=true;continue;
    }
    if(!block)continue;
    if(/^\S/.test(raw)){block=false;continue;}
    const match=/^ +-[ \t]+(?:(['"])([^'"\r\n]+)\1|([^\s#'"\[\]{},&|>:]+))[ \t]*(?:#.*)?$/.exec(raw);
    if(!match||raw.includes('\t')||/^[*!]/.test(match[3]||'')){invalid=true;break;}
    patterns.push(match[2]||match[3]);
  }
  if(!found||invalid||!patterns.length||patterns.length>100){warnings.push({file:'pnpm-workspace.yaml',reason:'unsupported-workspace-declarations'});return null;}
  return patterns;
}
function workspacePackages(root,graph,warnings){
  let manifest={};try{manifest=JSON.parse(fs.readFileSync(safePath(root,'package.json'),'utf8'));}catch{}
  const npmPatterns=Array.isArray(manifest.workspaces)?manifest.workspaces:manifest.workspaces?.packages;
  const pnpm=pnpmPatterns(root,new Set(graph.files),warnings);
  if(npmPatterns!==undefined&&graph.files.includes('pnpm-workspace.yaml')){warnings.push({file:'pnpm-workspace.yaml',reason:'ambiguous-workspace-declarations'});return new Map();}
  const patterns=npmPatterns??pnpm;
  if(patterns===undefined)return new Map();
  if(patterns===null)return new Map();
  const declaration=pnpm?'pnpm-workspace.yaml':'package.json';
  if(!Array.isArray(patterns)||patterns.length>100||patterns.some(pattern=>typeof pattern!=='string'||!pattern||(!pnpm&&pattern.startsWith('!'))||pattern==='!'||pattern.includes('..')||path.posix.isAbsolute(pattern.replace(/^!/,''))||/[\\\0]/.test(pattern))){warnings.push({file:declaration,reason:'unsupported-workspace-declarations'});return new Map();}
  const packages=new Map();
  for(const file of graph.files.filter(file=>file.endsWith('/package.json'))){
    const directory=path.posix.dirname(file);if(!patterns.some(pattern=>!pattern.startsWith('!')&&path.matchesGlob(directory,pattern.replace(/\/$/,'')))||patterns.some(pattern=>pattern.startsWith('!')&&path.matchesGlob(directory,pattern.slice(1).replace(/\/$/,''))))continue;
    try{
      const pkg=JSON.parse(fs.readFileSync(safePath(root,file),'utf8'));if(typeof pkg.name!=='string'||!pkg.name)continue;
      const inputs=graph.files.filter(input=>input.startsWith(directory+'/')&&!TEST.test(input)&&!graph.tests.includes(input));
      const entry={name:pkg.name,directory,inputs,declaration};packages.set(pkg.name,[...(packages.get(pkg.name)||[]),entry]);
    }catch{warnings.push({file,reason:'invalid-workspace-package-json'});}
  }
  return packages;
}

/** Bounded review-only candidates. Native configuration remains the resolution authority. */
export function routingProposals(root){
  root=path.resolve(root);const config=readConfig(root);rejectProbes(config);
  const before=snapshot(root,config),producer=implementation(),graph=buildGraph(root),files=new Set(graph.files);
  const proposals=[],warnings=[...graph.warnings],serviceSuggestions=[],unresolved=[];
  const packages=workspacePackages(root,graph,warnings),seen=new Set();let truncated=false,edges=0;
  function add(file,inputs,consumers,kind,evidence,extra={}){
    inputs=[...new Set(inputs)].sort();consumers=[...new Set(consumers)].sort();
    if(!inputs.length||!consumers.length)return;
    if(inputs.length>MAX_INPUTS||consumers.length>MAX_TESTS||edges+inputs.length*consumers.length>MAX_EDGES){truncated=true;warnings.push({file,reason:'proposal-input-group-over-bound'});return;}
    const key=digest({file,inputs,consumers,kind});if(seen.has(key))return;seen.add(key);
    if(proposals.length>=MAX_PROPOSALS){truncated=true;return;}
    edges+=inputs.length*consumers.length;
    const configurationInputs=inputs.filter(input=>graph.configFiles.has(input)||/(?:^|\/)(?:package(?:-lock)?\.json|[^/]*config\.[^/]+|pnpm-lock\.yaml|yarn\.lock)$/.test(input));
    proposals.push({id:key,source:file,input:inputs[0],inputs,tests:consumers,kind,
      evidence:{...evidence,sourceHash:before.files[file],inputHashes:Object.fromEntries(inputs.map(input=>[input,before.files[input]])),consumerPaths:evidence.consumerPaths||Object.fromEntries(consumers.map(test=>[test,evidencePath(graph,test,file)]))},
      patch:{dependencies:Object.fromEntries(consumers.map(test=>[test,inputs]))},status:'review-required',authority:'proposal-only',closedWorld:false,
      explanation:`Review evidence associates ${consumers.length} test file(s) with ${file}; ${kind} suggests ${inputs.length} input(s). Review and challenge the added edges before adoption.`,
      configurationInputs,configurationPolicy:configurationInputs.length?'retain-global-configuration-fallback':'existing-configuration-policy',
      limitations:LIMITATIONS,...extra});
  }
  for(const [file,text] of Object.entries(graph.sources)){
    const consumers=graph.tests.filter(test=>test===file||evidencePath(graph,test,file));if(!consumers.length)continue;
    if(Buffer.byteLength(text)>MAX_REFERENCE_BYTES){warnings.push({file,reason:'proposal-reference-source-over-bound'});continue;}
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);if(ast.parseDiagnostics.length){warnings.push({file,reason:'proposal-source-parse-incomplete'});continue;}
    function visit(node){
      const relative=modulePath(node,ast,file);
      if(relative){const input=local(root,files,relative.value,relative.base);if(input)add(file,[input],consumers,relative.kind,{line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});else if(unresolved.length<1000)unresolved.push({source:file,kind:relative.kind,reason:'literal-input-not-safe-existing-project-file'});}
      if(ts.isCallExpression(node)&&/(?:^|\.)(?:readFile|readFileSync|createReadStream|readdir|readdirSync|stat|statSync|access|accessSync)$/.test(node.expression.getText(ast))){
        const value=literal(node.arguments[0]);if(value!==null){const input=local(root,files,value);if(input)add(file,[input],consumers,'literal-cwd-path',{line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});else if(unresolved.length<1000)unresolved.push({source:file,kind:'literal-cwd-path',reason:'literal-input-not-safe-existing-project-file'});}
      }
      // Record only the variable name. Endpoints and credentials are not service revisions.
      if(ts.isPropertyAccessExpression(node)&&node.expression.getText(ast)==='process.env'&&/^[A-Z][A-Z\d_]*(?:URL|HOST|ENDPOINT|VERSION|REVISION)$/.test(node.name.text)&&serviceSuggestions.length<1000){
        const env=node.name.text,id=digest({file,env,consumers});if(!serviceSuggestions.some(entry=>entry.id===id))serviceSuggestions.push({id,source:file,tests:consumers,environmentVariable:env,status:'review-required',authority:'proposal-only',patch:null,closedWorld:false,requirements:['Confirm the service and every consuming test.','Provide a trustworthy service revision/version signal; endpoint and credential values do not establish freshness.'],reason:'external-service-state-unverified'});
      }
      ts.forEachChild(node,visit);
    }
    visit(ast);
    for(const specifier of imports(ast)){
      if(specifier.startsWith('.')||specifier.startsWith('#')||specifier.includes(':'))continue;
      const matches=packages.get(packageName(specifier));if(!matches)continue;
      if(matches.length!==1){warnings.push({file,reason:'ambiguous-workspace-package-name'});continue;}
      const pkg=matches[0];add(file,pkg.inputs,consumers,'workspace-package-input-group',{specifier,packageName:pkg.name,workspaceDirectory:pkg.directory,workspaceDeclaration:pkg.declaration,workspaceDeclarationHash:before.files[pkg.declaration]}, {limitations:[...LIMITATIONS,'The group includes tracked package source/assets and metadata, not transitive services or files outside the package. Review native exports, conditions and package binding.']});
    }
  }
  // CSS observations remain proposals: comments, preprocessors and served URL bases need review.
  const styleQueue=graph.files.filter(file=>/\.(?:css|scss|sass|less)$/.test(file)&&graph.tests.some(test=>evidencePath(graph,test,file)));
  const visitedStyles=new Set(),styleReferences=[],suggestedGraph={...graph,edges:{...graph.edges}};
  for(let index=0;index<styleQueue.length&&index<1000;index++){
    const file=styleQueue[index];if(visitedStyles.has(file))continue;visitedStyles.add(file);
    const size=fs.statSync(safePath(root,file)).size;if(size>MAX_REFERENCE_BYTES){warnings.push({file,reason:'proposal-reference-source-over-bound'});continue;}
    const text=fs.readFileSync(safePath(root,file),'utf8');
    for(const match of text.matchAll(/(?:url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"])/g)){
      const input=local(root,files,match[1]||match[2],path.posix.dirname(file));if(!input){if(unresolved.length<1000)unresolved.push({source:file,kind:'literal-style-resource',reason:'resource-not-safe-existing-project-file'});continue;}
      if(styleReferences.length>=MAX_EDGES){truncated=true;warnings.push({file,reason:'proposal-style-reference-count-over-bound'});break;}
      styleReferences.push({file,input,offset:match.index});suggestedGraph.edges[file]=[...new Set([...(suggestedGraph.edges[file]||[]),input])];
      if(/\.(?:css|scss|sass|less)$/.test(input)&&!visitedStyles.has(input)&&!styleQueue.includes(input))styleQueue.push(input);
    }
  }
  for(const {file,input,offset} of styleReferences){
    const consumerPaths=Object.fromEntries(graph.tests.map(test=>[test,evidencePath(suggestedGraph,test,file)]).filter(([,chain])=>chain));
    add(file,[input],Object.keys(consumerPaths),'literal-style-resource',{referenceOffset:offset,consumerPaths}, {limitations:[...LIMITATIONS,'Consumer paths may include other suggested CSS edges; they remain review evidence only. CSS literals can occur in comments or depend on bundler/served URL semantics.']});
  }
  if(styleQueue.length>1000){truncated=true;warnings.push({file:'styles',reason:'proposal-style-reference-count-over-bound'});}
  const after=snapshot(root,config),stable=freshness(before,after).fresh&&digest(producer)===digest(implementation());
  return seal({schemaVersion:1,type:'routing-mapping-proposal',applied:false,reviewRequired:true,closedWorld:false,provenance:before,configurationHash:digest(config),producer,stable,proposals,truncated,serviceSuggestions,unresolved,warnings,unmappedChangesPolicy:'full-suite',limits:{proposals:MAX_PROPOSALS,inputsPerProposal:MAX_INPUTS,testsPerProposal:MAX_TESTS,dependencyEdges:MAX_EDGES,referenceSourceBytes:MAX_REFERENCE_BYTES},limitations:LIMITATIONS});
}

/** Revalidate an automatically generated proposal before qualification/review. */
export function validateRoutingProposals(root,proposal){
  root=path.resolve(root);const config=readConfig(root);rejectProbes(config);
  if(!proposal||proposal.type!=='routing-mapping-proposal'||proposal.schemaVersion!==1)throw new Error('Expected a generated routing mapping proposal');
  const {integrity,...payload}=proposal;
  if(integrity!==digest(payload)||proposal.configurationHash!==digest(config)||digest(proposal.producer)!==digest(implementation()))throw new Error('Routing proposal integrity, configuration or producer changed');
  if(proposal.applied!==false||proposal.reviewRequired!==true||proposal.closedWorld!==false||proposal.stable!==true)throw new Error('Routing proposal authority or stability is invalid');
  const check=freshness(proposal.provenance,snapshot(root,config));if(!check.fresh)throw new Error(`Routing proposal is stale: ${check.reasons.join(', ')}`);
  if(!Array.isArray(proposal.proposals)||proposal.proposals.length>MAX_PROPOSALS)throw new Error('Routing proposal count exceeded');
  let edges=0;
  for(const entry of proposal.proposals){
    if(entry.authority!=='proposal-only'||entry.status!=='review-required'||entry.closedWorld!==false||!entry.patch||Object.keys(entry.patch).some(key=>key!=='dependencies'))throw new Error('Invalid routing mapping entry authority');
    if(!Array.isArray(entry.inputs)||!entry.inputs.length||entry.inputs.length>MAX_INPUTS||!Array.isArray(entry.tests)||!entry.tests.length||entry.tests.length>MAX_TESTS)throw new Error('Invalid routing mapping entry paths');
    safePath(root,entry.source);
    if(entry.id!==digest({file:entry.source,inputs:entry.inputs,consumers:entry.tests,kind:entry.kind})||entry.evidence?.sourceHash!==proposal.provenance.files[entry.source]||digest(entry.evidence?.inputHashes)!==digest(Object.fromEntries(entry.inputs.map(input=>[input,proposal.provenance.files[input]]))))throw new Error('Routing mapping evidence does not match retained provenance');
    if(entry.kind==='workspace-package-input-group'&&(!['package.json','pnpm-workspace.yaml'].includes(entry.evidence.workspaceDeclaration)||entry.evidence.workspaceDeclarationHash!==proposal.provenance.files[entry.evidence.workspaceDeclaration]))throw new Error('Workspace declaration evidence does not match retained provenance');
    if(Object.keys(entry.patch.dependencies||{}).length>MAX_TESTS)throw new Error('Routing proposal test count exceeded');
    for(const [test,inputs]of Object.entries(entry.patch.dependencies||{})){
      safePath(root,test);if(!Object.hasOwn(proposal.provenance.files,test)||!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_INPUTS)throw new Error('Invalid routing mapping paths');
      for(const input of inputs){safePath(root,input);if(!Object.hasOwn(proposal.provenance.files,input))throw new Error('Routing mapping input is outside project provenance');}
      edges+=inputs.length;if(edges>MAX_EDGES)throw new Error('Routing proposal dependency edge count exceeded');
    }
    if(digest(entry.patch.dependencies)!==digest(Object.fromEntries(entry.tests.map(test=>[test,entry.inputs]))))throw new Error('Routing mapping patch does not match retained evidence');
  }
  return {valid:true,reviewRequired:true,closedWorld:false,applied:false,integrity:proposal.integrity,limitations:LIMITATIONS};
}
