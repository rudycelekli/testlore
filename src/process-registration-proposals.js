import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {typescript as ts, assertCurrentEngine, loadedIdentity} from './syntax-engine.cjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const implementationSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url),'utf8'));
function currentImplementation(){if(hash(fs.readFileSync(fileURLToPath(import.meta.url),'utf8'))!==implementationSha256)throw Error('Loaded process proposal implementation changed');return implementationSha256;}
const LIMITS = Object.freeze({sources:4096, sourceBytes:524288, totalSourceBytes:16777216, edges:25000, tests:1000, proposals:32, launches:256, visits:200000, consumerWork:100000, outputBytes:4194304});
const safe = value => typeof value === 'string' && value.length > 0 && value.length < 4096 && !/[\\\x00-\x1f\x7f:%?#*]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..' || ['.git','node_modules','.tddswarm'].includes(part));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const TEST = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
function bindings(value = {}) {
  if(!plain(value) || Object.keys(value).some(key => !['runtime','inputs'].includes(key))) throw Error('Invalid process input bindings');
  const runtime=value.runtime ?? null, inputs=value.inputs ?? [];
  if(runtime !== null && (!plain(runtime) || Object.keys(runtime).sort().join(',') !== 'executableSha256,kind,version' || !['node','bun'].includes(runtime.kind) || typeof runtime.version !== 'string' || !/^[v\d][A-Za-z0-9.+-]{0,127}$/.test(runtime.version) || !sha(runtime.executableSha256))) throw Error('Invalid runtime binding');
  if(!Array.isArray(inputs) || inputs.length>256 || inputs.some(input => !plain(input) || Object.keys(input).sort().join(',')!=='name,sha256' || typeof input.name!=='string' || !/^[A-Za-z0-9_./:-]{1,256}$/.test(input.name) || !sha(input.sha256)) || new Set(inputs.map(input=>input.name)).size!==inputs.length) throw Error('Invalid process input binding');
  return {runtime,inputs:[...inputs].sort((a,b)=>a.name.localeCompare(b.name)).map(input=>({...input}))};
}
function index(graph) {
  if(!plain(graph) || !plain(graph.sources) || !plain(graph.edges) || !Array.isArray(graph.tests) || !Array.isArray(graph.warnings)) throw Error('Invalid process proposal graph');
  const files=Object.keys(graph.sources).sort();
  if(files.length>LIMITS.sources || graph.tests.length>LIMITS.tests || Object.keys(graph.edges).length>LIMITS.sources || graph.warnings.length>10000) throw Error('Process proposal inventory budget exceeded');
  let bytes=0,edges=0;
  for(const file of files) {
    if(!safe(file) || typeof graph.sources[file]!=='string' || Buffer.byteLength(graph.sources[file])>LIMITS.sourceBytes) throw Error('Unsafe or oversized process source');
    bytes+=Buffer.byteLength(graph.sources[file]);
  }
  if(bytes>LIMITS.totalSourceBytes || graph.tests.some(file=>!safe(file)) || new Set(graph.tests).size!==graph.tests.length) throw Error('Process proposal inventory budget exceeded');
  for(const [file,items] of Object.entries(graph.edges)) {
    if(!safe(file) || !Array.isArray(items) || items.length>LIMITS.edges || items.some(item=>!safe(item))) throw Error('Unsafe process graph edges');
    edges+=items.length;
  }
  if(edges>LIMITS.edges) throw Error('Process proposal edge budget exceeded');
  return files;
}
function consumerCharge(budget){if(++budget.consumerWork>LIMITS.consumerWork)throw Error('Process aggregate consumer traversal budget exceeded');}
function closure(graph,start,target,budget) {
  consumerCharge(budget);
  const key=JSON.stringify([start,target]);if(budget.reachability.has(key))return budget.reachability.get(key);
  const parents=new Map([[start,null]]),queue=[start];
  for(let i=0;i<queue.length;i++) {
    consumerCharge(budget);const file=queue[i];
    if(file===target){const chain=[];for(let item=file;item!==null;item=parents.get(item))chain.push(item);chain.reverse();budget.reachability.set(key,chain);return chain;}
    for(const dep of graph.edges[file]||[]){consumerCharge(budget);if(!parents.has(dep)){parents.set(dep,file);queue.push(dep);}}
    if(queue.length>LIMITS.edges+LIMITS.sources)throw Error('Process consumer traversal budget exceeded');
  }
  budget.reachability.set(key,null);return null;
}
function resolve(file,spec,sources) {
  if(!spec.startsWith('.'))return null;
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  const choices=[base,base.replace(/\.js$/,'.ts'),base.replace(/\.mjs$/,'.mts')].filter(item=>safe(item)&&Object.hasOwn(sources,item));
  return [...new Set(choices)].length===1 ? choices[0] : null;
}
function charge(budget){if(++budget.visits>LIMITS.visits)throw Error('Process aggregate syntax traversal budget exceeded');}
function parse(file,text,budget) {
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true), imports=new Map(),decls=new Map(),top=new Map();let intrinsicMutation=false;
  const add=name=>decls.set(name,(decls.get(name)||0)+1);
  function visit(node) {
    charge(budget);
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&/^(?:(?:globalThis\.)?(?:URL|process)|process\.execPath)$/.test(node.left.getText(ast)))intrinsicMutation=true;
    if(ts.isCallExpression(node)&&['eval','Function','Object.defineProperty','Object.defineProperties','Reflect.set'].includes(node.expression.getText(ast)))intrinsicMutation=true;
    if((ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name) {
      const names=n=>{if(ts.isIdentifier(n))add(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))for(const el of n.elements)if(ts.isBindingElement(el))names(el.name);}; names(node.name);
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  for(const statement of ast.statements) {
    if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)) {
      const b=statement.importClause?.namedBindings;
      if(statement.importClause?.name)add(statement.importClause.name.text);
      if(b&&ts.isNamespaceImport(b))add(b.name.text);
      if(b&&ts.isNamedImports(b))for(const el of b.elements) {add(el.name.text);imports.set(el.name.text,{specifier:statement.moduleSpecifier.text,exported:(el.propertyName||el.name).text,alias:Boolean(el.propertyName)});}
    }
    if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name))top.set(d.name.text,d);
  }
  return {ast,imports,decls,top,intrinsicMutation};
}
const span=(node,ast,text)=>({start:node.getStart(ast),end:node.end,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,sha256:hash(text.slice(node.getStart(ast),node.end))});
function lexicalOwners(parsed,text,budget) {
  const owners=[],unknown=[];const {ast,top,imports,decls}=parsed;
  for(const [name,d] of top) {
    if(!d.initializer || !ts.isArrowFunction(d.initializer) || !ts.isCallExpression(d.initializer.body))continue;
    const call=d.initializer.body,e=call.expression;
    if(!ts.isPropertyAccessExpression(e)||!ts.isIdentifier(e.expression)||!/^register/.test(e.name.text))continue;
    const receiver=e.expression.text,owner=top.get(receiver),constructor=owner?.initializer;
    if(decls.get(name)!==1||decls.get(receiver)!==1||!constructor||!ts.isNewExpression(constructor)||!ts.isIdentifier(constructor.expression)){unknown.push('ambiguous-registration-state-owner');continue;}
    const imported=imports.get(constructor.expression.text);
    owners.push({helper:name,receiver,method:e.name.text,helperDeclaration:span(d,ast,text),stateDeclaration:span(owner,ast,text),constructor:{name:constructor.expression.text,import:imported||null},lexicalStateCandidates:[...top].map(([binding,node])=>({binding,...span(node,ast,text)}))});
    if(!imported||imported.alias)unknown.push('unknown-or-aliased-state-constructor');
    function escapes(node) {
      charge(budget);
      if(ts.isIdentifier(node)&&[name,receiver].includes(node.text)) {
        const p=node.parent;
        const declaration=ts.isVariableDeclaration(p)&&p.name===node;
        const directCall=ts.isCallExpression(p)&&p.expression===node;
        const receiverAccess=ts.isPropertyAccessExpression(p)&&p.expression===node;
        if(!declaration&&!directCall&&!receiverAccess)unknown.push(node.text===name?'registration-helper-alias-or-escape':'state-owner-alias-or-escape');
      }
      ts.forEachChild(node,escapes);
    }
    escapes(ast);
  }
  return {owners,unknown};
}
function bridges(file,text,parsed,fixtures,graph,budget) {
  const {ast,imports,decls,top}=parsed, references=new Map(),unknown=new Set();const launches=[];
  const converter=imports.get('fileURLToPath');
  for(const [name,d] of top) {
    const c=d.initializer;
    if(!c||!ts.isCallExpression(c)||!ts.isIdentifier(c.expression)||c.expression.text!=='fileURLToPath')continue;
    const u=c.arguments[0];
    if(!converter||converter.specifier!=='node:url'||converter.alias||decls.get('fileURLToPath')!==1||decls.get(name)!==1||decls.has('URL')||parsed.intrinsicMutation){unknown.add('aliased-or-shadowed-fixture-path');continue;}
    if(c.arguments.length!==1||!u||!ts.isNewExpression(u)||u.expression.getText(ast)!=='URL'||u.arguments?.length!==2||!ts.isStringLiteral(u.arguments[0])||u.arguments[1].getText(ast)!=='import.meta.url'){unknown.add('dynamic-fixture-path');continue;}
    const raw=u.arguments[0].text,target=path.posix.normalize(path.posix.join(path.posix.dirname(file),raw));
    if(!raw.startsWith('.')||/[\\%?#:]/.test(raw)||!safe(target)){unknown.add('unsafe-fixture-path');continue;}
    if(fixtures.has(target))references.set(name,{fixture:target,declaration:span(d,ast,text)});
  }
  
  function visit(node) {
    charge(budget);
    if(ts.isCallExpression(node)&&node.arguments.length===1&&ts.isObjectLiteralExpression(node.arguments[0])) {
      const object=node.arguments[0],fields=new Map(),spreads=object.properties.filter(ts.isSpreadAssignment);
      for(const prop of object.properties)if(ts.isPropertyAssignment(prop)&&ts.isIdentifier(prop.name))fields.set(prop.name.text,prop.initializer);
      const argv=fields.get('arguments')||fields.get('args');
      if(argv&&ts.isArrayLiteralExpression(argv)&&argv.elements.some(el=>ts.isIdentifier(el)&&references.has(el.text))) {
        const uncertainties=new Set(['independent-process-input-and-regression-challenge-required','effective-launch-not-established-by-static-source']);
        const name=ts.isIdentifier(node.expression)?node.expression.text:null,sink=name?imports.get(name):null;
        if(!sink||sink.alias||decls.get(name)!==1)uncertainties.add('unknown-or-aliased-launch-sink');
        const sinkFile=sink?resolve(file,sink.specifier,graph.sources):null;
        if(!sinkFile)uncertainties.add('launch-implementation-source-unavailable');
        if(spreads.length)uncertainties.add('inherited-process-options');
        const command=fields.get('command'),env=fields.get('env'),cwd=fields.get('cwd');
        if(!command||command.getText(ast)!=='process.execPath'||decls.has('process'))uncertainties.add('unknown-or-shadowed-executable');
        if(!cwd)uncertainties.add('effective-cwd-unbound');
        if(argv.elements.length!==1||argv.elements.some(el=>!ts.isIdentifier(el)||!references.has(el.text)))uncertainties.add('additional-or-dynamic-argv');
        if(!env||!ts.isObjectLiteralExpression(env))uncertainties.add('effective-environment-unbound');
        const envKeys=[];
        if(env&&ts.isObjectLiteralExpression(env))for(const prop of env.properties) {
          if(ts.isSpreadAssignment(prop))uncertainties.add('inherited-environment');
          else if(ts.isPropertyAssignment(prop)&&ts.isIdentifier(prop.name)){envKeys.push({name:prop.name.text,valueExpressionSha256:hash(prop.initializer.getText(ast))});if(!ts.isStringLiteral(prop.initializer))uncertainties.add('dynamic-environment-value');}
          else uncertainties.add('dynamic-environment-key');
        }
        if(object.properties.some(prop=>!ts.isPropertyAssignment(prop)&&!ts.isSpreadAssignment(prop))||object.properties.some(prop=>ts.isPropertyAssignment(prop)&&!ts.isIdentifier(prop.name)))uncertainties.add('computed-or-unknown-launch-option');
        const names=object.properties.filter(ts.isPropertyAssignment).map(prop=>prop.name.getText(ast));
        if(new Set(names).size!==names.length)uncertainties.add('duplicate-launch-option');
        launches.push({kind:'imported-call-with-fixture-argv-candidate',executionObserved:false,source:file,sourceSha256:hash(text),call:span(node,ast,text),fixtureBindings:argv.elements.filter(el=>ts.isIdentifier(el)&&references.has(el.text)).map(el=>({name:el.text,...references.get(el.text)})),sink:{callee:name,import:sink||null,file:sinkFile,sourceSha256:sinkFile?hash(graph.sources[sinkFile]):null},environmentKeys:envKeys.sort((a,b)=>a.name.localeCompare(b.name)),uncertainties:[...uncertainties].sort()});
        if(launches.length>LIMITS.launches)throw Error('Process launch proposal budget exceeded');
      } else if(argv&&!ts.isArrayLiteralExpression(argv))unknown.add('dynamic-process-argv');
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);return {launches,unknown:[...unknown].sort()};
}

/** Static, source-bound diagnosis only. No subprocess, probe, mapping patch or omission permission. */
export function processRegistrationProposals(graph,currentBindings={}) {
  assertCurrentEngine();
  const files=index(graph),bound=bindings(currentBindings),parsed=new Map(),diagnostics=[],budget={visits:0,consumerWork:0,reachability:new Map()};
  const fixtureFiles=[...new Set(graph.warnings.filter(w=>w?.reason==='runtime-registration'&&safe(w.file)).map(w=>w.file))].sort();
  if(fixtureFiles.length>LIMITS.proposals)throw Error('Process registration proposal budget exceeded');
  const fixtures=new Set(fixtureFiles),bridgeIndex=new Map(fixtureFiles.map(file=>[file,[]]));
  if(fixtureFiles.length)for(const file of files) {
    const text=graph.sources[file];
    if(!fixtures.has(file)&&!text.includes('fileURLToPath'))continue;
    const result=parse(file,text,budget);parsed.set(file,result);
    if(result.ast.parseDiagnostics.length){diagnostics.push({file,reason:'source-parse-incomplete'});continue;}
    const bridge=bridges(file,text,result,fixtures,graph,budget);
    for(const reason of bridge.unknown)diagnostics.push({file,reason});
    for(const launch of bridge.launches)for(const target of new Set(launch.fixtureBindings.map(binding=>binding.fixture))) {
      bridgeIndex.get(target).push(launch);
      if(bridgeIndex.get(target).length>LIMITS.launches)throw Error('Process launch proposal budget exceeded');
    }
  }
  const proposals=[];
  for(const fixture of fixtureFiles) {
    if(!parsed.has(fixture)){diagnostics.push({file:fixture,reason:'registration-source-unavailable'});continue;}
    const local=parsed.get(fixture).ast.parseDiagnostics.length ? {owners:[],unknown:['registration-source-parse-incomplete']} : lexicalOwners(parsed.get(fixture),graph.sources[fixture],budget),launches=bridgeIndex.get(fixture),uncertainties=new Set(local.unknown);
    if(!local.owners.length)uncertainties.add('registration-state-owner-unresolved');
    if(!launches.length)uncertainties.add('fixture-launch-consumers-unresolved');
    const discoveredConsumerCandidates=[],excludedConsumerCandidates=[];
    for(const test of files.filter(file=>graph.tests.includes(file)||TEST.test(file))) {
      const chains=launches.map(launch=>({launchSource:launch.source,chain:closure(graph,test,launch.source,budget)})).filter(item=>item.chain);
      if(!chains.length)continue;
      const item={file:test,sourceSha256:hash(graph.sources[test]),evidenceScope:'static-import-path-only',paths:chains};
      (graph.tests.includes(test)?discoveredConsumerCandidates:excludedConsumerCandidates).push(item);
    }
    if(excludedConsumerCandidates.length)uncertainties.add('consumer-candidates-outside-native-inventory');
    if(!discoveredConsumerCandidates.length)uncertainties.add('no-discovered-test-consumer');
    if(bound.runtime===null)uncertainties.add('runtime-executable-unbound');
    if(!bound.inputs.length)uncertainties.add('effective-process-inputs-unbound');
    uncertainties.add('consumer-completeness-unproven');uncertainties.add('external-package-and-shared-state-effects-unqualified');
    proposals.push({fixture,sourceSha256:hash(graph.sources[fixture]),stateOwners:local.owners,launches,consumers:[],discoveredConsumerCandidates,excludedConsumerCandidates,uncertainties:[...uncertainties].sort(),authority:'diagnostic-only',closedWorld:false,omissionAuthority:false,nextAction:'Record effective executable/argv/cwd/environment and imported implementation identity in a fresh full shadow run; independently challenge affected and unrelated original cases before reviewing any added mapping.'});
  }
  assertCurrentEngine();
  const producer={module:'process-registration-proposals.js',sha256:currentImplementation(),typescript:ts.version,engine:{identity:loadedIdentity,provenance:loadedIdentity?'canonical-loaded-engine':'unverified-preloaded-engine'}};
  if(!loadedIdentity)diagnostics.push({file:'syntax-engine',reason:'loaded-engine-provenance-unverified'});
  const sourceBindings=Object.fromEntries(files.map(file=>[file,hash(graph.sources[file])]));
  const payload={schemaVersion:1,type:'process-registration-proposals',producer,bindings:bound,sourceBindings,graphBinding:hash({edges:graph.edges,tests:graph.tests,warnings:graph.warnings}),proposals,diagnostics,existingUncertainties:graph.warnings,limits:LIMITS,reviewRequired:true,closedWorld:false,omissionAuthority:false,fallbackPolicy:'retain-all-existing-uncertainty',limitations:['Static launch candidates may be unreachable or affected by aliases and native transforms.','Bindings attest inspected bytes and caller-supplied receipts, not truthful or complete effective runtime inputs.','Lexical state candidates are an overapproximation; source hashes do not establish state isolation or complete consumers.']};
  if(Buffer.byteLength(JSON.stringify(payload))>LIMITS.outputBytes)throw Error('Process proposal output budget exceeded');
  return {...payload,integrity:hash(payload)};
}

/** Recompute every diagnostic against current sources/graph/input receipts; freshness is not qualification. */
export function validateProcessRegistrationProposals(proposal,graph,currentBindings={}) {
  if(!plain(proposal))throw Error('Invalid process registration proposal');
  const {integrity,...payload}=proposal;
  if(!sha(integrity)||integrity!==hash(payload))throw Error('Process proposal integrity changed');
  const current=processRegistrationProposals(graph,currentBindings);
  if(current.integrity!==integrity)throw Error('Process proposal source, producer, graph, runtime or inputs changed');
  return {valid:true,reviewRequired:true,closedWorld:false,omissionAuthority:false,qualified:false,integrity,uncertaintyCount:current.proposals.reduce((count,item)=>count+item.uncertainties.length+item.launches.reduce((n,launch)=>n+launch.uncertainties.length,0),0)};
}

/** Inspect integrity/authority and declared source bindings only. No graph or native execution. */
export function inspectProcessRegistrationProposalEnvelope(proposal,currentSourceHashes) {
  assertCurrentEngine();
  if(!plain(proposal))throw Error('Invalid process proposal envelope');
  if(Object.keys(proposal).some(key=>!['schemaVersion','type','producer','bindings','sourceBindings','graphBinding','proposals','diagnostics','existingUncertainties','limits','reviewRequired','closedWorld','omissionAuthority','fallbackPolicy','limitations','integrity'].includes(key)))throw Error('Unknown process proposal envelope fields');
  if(Buffer.byteLength(JSON.stringify(proposal))>LIMITS.outputBytes+128)throw Error('Process proposal envelope budget exceeded');
  const {integrity,...payload}=proposal;
  if(proposal.type!=='process-registration-proposals'||proposal.schemaVersion!==1||!sha(integrity)||integrity!==hash(payload))throw Error('Process proposal envelope integrity changed');
  if(proposal.omissionAuthority!==false||proposal.closedWorld!==false||proposal.reviewRequired!==true||proposal.fallbackPolicy!=='retain-all-existing-uncertainty')throw Error('Invalid process proposal envelope authority');
  if(!plain(proposal.sourceBindings)||Object.keys(proposal.sourceBindings).length>LIMITS.sources||Object.entries(proposal.sourceBindings).some(([file,digest])=>!safe(file)||!sha(digest)))throw Error('Invalid process source bindings');
  if(!plain(proposal.producer)||proposal.producer.module!=='process-registration-proposals.js'||!sha(proposal.producer.sha256)||proposal.producer.sha256!==currentImplementation()||proposal.producer.typescript!==ts.version)throw Error('Process proposal producer changed');
  if(hash(proposal.producer.engine)!==hash({identity:loadedIdentity,provenance:loadedIdentity?'canonical-loaded-engine':'unverified-preloaded-engine'}))throw Error('Process proposal syntax engine binding changed');
  bindings(proposal.bindings);
  if(!Array.isArray(proposal.proposals)||proposal.proposals.length>LIMITS.proposals||proposal.proposals.some(item=>item?.omissionAuthority!==false||item?.closedWorld!==false||item?.authority!=='diagnostic-only'||Object.hasOwn(item,'patch')||!Array.isArray(item.consumers)||item.consumers.length!==0))throw Error('Invalid nested process proposal authority');
  const matches=record=>record&&safe(record.source||record.file||record.fixture)&&record.sourceSha256===proposal.sourceBindings[record.source||record.file||record.fixture];
  for(const item of proposal.proposals){
    if(!matches(item)||!Array.isArray(item.launches)||item.launches.length>LIMITS.launches||!Array.isArray(item.discoveredConsumerCandidates)||!Array.isArray(item.excludedConsumerCandidates)||item.discoveredConsumerCandidates.length+item.excludedConsumerCandidates.length>LIMITS.sources)throw Error('Invalid nested process source bindings');
    for(const launch of item.launches){
      if(!matches(launch)||launch.executionObserved!==false||launch.kind!=='imported-call-with-fixture-argv-candidate')throw Error('Invalid process launch candidate binding');
      if(launch.sink?.file!==null&&(!safe(launch.sink?.file)||launch.sink.sourceSha256!==proposal.sourceBindings[launch.sink.file]))throw Error('Invalid process sink source binding');
    }
    if([...item.discoveredConsumerCandidates,...item.excludedConsumerCandidates].some(candidate=>!matches(candidate)||candidate.evidenceScope!=='static-import-path-only'))throw Error('Invalid process consumer candidate binding');
  }
  if(currentSourceHashes!==undefined){
    if(!plain(currentSourceHashes))throw Error('Invalid current source hashes');
    for(const [file,digest] of Object.entries(proposal.sourceBindings))if(currentSourceHashes[file]!==digest)throw Error('Process proposal source binding changed');
  }
  return {valid:true,qualified:false,omissionAuthority:false,sourceBindingsChecked:currentSourceHashes!==undefined,requiresFreshGraphAndLaunchInputs:true,semanticRevalidation:false,integrity};
}
