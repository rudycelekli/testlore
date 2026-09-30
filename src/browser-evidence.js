import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readConfig,safePath,normalize,listFiles} from './files.js';
import {adapterFor,discover,execute} from './execution.js';
import {snapshot,freshness,digest} from './provenance.js';

const MAX_BYTES=2*1024*1024,MAX_TOTAL=16*1024*1024,MAX_CASES=2000;
const LIMITATIONS=['Browser requests and executed coverage are observations, not proof of unexercised branches or a complete closed world.','Only an explicitly configured URL root or server input declaration gives a request authority to map to project files.','Coverage is Chromium only; additional pages, external services, unknown source maps and missing instrumentation require review and conservative fallback.'];
function readBounded(file,max=MAX_BYTES){const size=fs.statSync(file).size;if(size>max)throw new Error('Browser artifact exceeds size bound');return fs.readFileSync(file,'utf8');}
function seal(payload){return {...payload,integrity:digest(payload)};}
function verify(record,type){const {integrity,...payload}=record||{};if(record?.schemaVersion!==1||record.type!==type||!integrity||integrity!==digest(payload))throw new Error('Invalid browser evidence integrity');}
function url(raw){const result=new URL(raw);if(!['http:','https:'].includes(result.protocol)||result.username||result.password||result.search||result.hash)throw new Error('Expected redacted HTTP browser URL');return result;}
function identity(value){return JSON.stringify([value.nativeId,value.repeatEachIndex]);}
function localFile(root,file){const target=safePath(root,file);if(!fs.statSync(target).isFile())throw new Error('Expected a local project file');return normalize(path.relative(root,target));}

/** Executes the configured native Playwright scope with explicit fixture instrumentation. */
export function captureBrowserEvidence(root,options={}){
  const config=readConfig(root);if(adapterFor(config)!=='playwright')throw new Error('Browser capture requires the native Playwright adapter');
  const timeoutMs=options.timeoutMs??120000;if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw new Error('Browser timeout must be 1000–600000 ms');
  const provenance=snapshot(root,config),inventory=discover(root,config);
  if(!inventory.complete||!inventory.files.length||inventory.files.length>MAX_CASES)throw new Error('Browser capture requires complete nonempty native discovery');
  const captureId=randomUUID(),directory=safePath(root,`.tddswarm/browser/${captureId}`);fs.mkdirSync(directory,{recursive:true});
  const execution=execute(root,inventory.files,{...config,env:{...config.env,TESTLORE_BROWSER_CAPTURE_DIRECTORY:directory}},{capture:true,timeoutMs});
  const warnings=[],observations=[],seen=new Set();let total=0;
  const artifacts=fs.readdirSync(directory).sort();if(artifacts.length>MAX_CASES)warnings.push('browser-artifact-count-exceeds-bound');
  for(const file of artifacts.slice(0,MAX_CASES)){
    if(!/^[a-f0-9]{64}\.json$/.test(file)){warnings.push('unexpected-capture-artifact');continue;}
    try{const raw=readBounded(safePath(root,`.tddswarm/browser/${captureId}/${file}`));total+=Buffer.byteLength(raw);if(total>MAX_TOTAL)throw new Error('Browser capture total bound exceeded');const value=JSON.parse(raw);if(value.schemaVersion!==1||typeof value.nativeId!=='string'||!Number.isInteger(value.repeatEachIndex)||!Number.isInteger(value.retry)||!Array.isArray(value.routes)||!Array.isArray(value.requests)||!value.coverage||!Array.isArray(value.warnings))throw new Error('Invalid browser observation');
      const key=identity(value),test=execution.tests.find(test=>identity(test)===key);if(!test||value.retry!==0||seen.has(key))throw new Error('Browser case identity or attempt mismatch');seen.add(key);
      if(value.routes.length>2000||value.requests.length>2000||value.warnings.length>100||['javascript','css'].some(kind=>!Array.isArray(value.coverage[kind])||value.coverage[kind].length>256))throw new Error('Browser observation bound exceeded');
      for(const route of value.routes)url(route);for(const request of value.requests){url(request.url);if(typeof request.type!=='string'||!Number.isInteger(request.status))throw new Error('Invalid browser request');}
      for(const kind of ['javascript','css'])for(const covered of value.coverage[kind]){url(covered.url);if(!Array.isArray(covered.ranges)||covered.ranges.length>10000||covered.ranges.some(range=>!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start))throw new Error('Invalid coverage ranges');}
      observations.push({...value,file:test.file,caseId:test.id,status:test.status,complete:value.complete===true&&test.status==='passed'});
    }catch(error){warnings.push(error.message);}
  }
  if(execution.tests.length>MAX_CASES)warnings.push('native-case-count-exceeds-browser-bound');
  const check=freshness(provenance,snapshot(root,config));
  for(const test of execution.tests)if(!seen.has(identity(test)))warnings.push(`missing-browser-instrumentation:${test.file}`);
  warnings.push(...check.reasons);
  const complete=inventory.complete&&execution.complete&&execution.exitCode===0&&execution.tests.length>0&&execution.tests.every(test=>test.status==='passed')&&!warnings.length&&observations.length===execution.tests.length&&observations.every(observation=>observation.complete);
  const record=seal({schemaVersion:1,type:'browser',captureId,provenance,configurationHash:digest(config),instrumentationHash:digest(fs.readFileSync(new URL('./browser-fixture.js',import.meta.url))),complete,inventory:{files:inventory.files,cases:execution.tests.map(test=>({id:test.id,nativeId:test.nativeId,repeatEachIndex:test.repeatEachIndex,file:test.file,status:test.status}))},observations,warnings:[...new Set(warnings)],execution:{complete:execution.complete,exitCode:execution.exitCode,durationMs:execution.durationMs},createdAt:new Date().toISOString(),limitations:LIMITATIONS});
  fs.writeFileSync(safePath(root,'.tddswarm/browser/evidence.json'),JSON.stringify(record,null,2));return record;
}

function rootsFor(root,raw){if(!Array.isArray(raw)||raw.length>100)throw new Error('urlRoots must be a bounded array');return raw.map(entry=>{if(!entry||typeof entry.directory!=='string'||typeof entry.urlPrefix!=='string')throw new Error('URL root needs origin, urlPrefix and directory');const origin=url(entry.origin);if(origin.pathname!=='/')throw new Error('URL root origin must have no path');if(!entry.urlPrefix.startsWith('/')||!entry.urlPrefix.endsWith('/')||entry.urlPrefix.includes('..')||entry.urlPrefix.includes('?')||entry.urlPrefix.includes('#'))throw new Error('Unsafe URL prefix');const target=safePath(root,entry.directory);if(!fs.statSync(target).isDirectory())throw new Error('URL root directory is unavailable');return {...entry,origin:origin.origin};});}
function requestFile(root,raw,roots){const request=url(raw);const matches=roots.filter(entry=>entry.origin===request.origin&&request.pathname.startsWith(entry.urlPrefix));if(matches.length!==1)return null;const entry=matches[0];let relative;try{relative=decodeURIComponent(request.pathname.slice(entry.urlPrefix.length));}catch{return null;}if(!relative||relative.startsWith('/')||relative.includes('?')||relative.includes('#'))return null;try{return localFile(root,normalize(entry.directory+'/'+relative));}catch{return null;}}
function sourceMapInputs(root,bundle,files,warnings){
  const target=safePath(root,bundle);if(fs.statSync(target).size>MAX_BYTES){warnings.push(`bundle-too-large:${bundle}`);return [];}
  const text=fs.readFileSync(target,'utf8'),match=[...text.matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)/g)].at(-1);if(!match)return [];
  const reference=match[1];if(/^[a-z]+:|^[\/\\]/i.test(reference)||reference.includes('?')||reference.includes('#')){warnings.push(`source-map-reference-unsupported:${bundle}`);return [];}
  let mapFile;try{mapFile=localFile(root,normalize(path.posix.join(path.posix.dirname(bundle),reference)));const map=JSON.parse(readBounded(safePath(root,mapFile)));if(map.version!==3||!Array.isArray(map.sources)||map.sources.length>2000||typeof(map.sourceRoot||'')!=='string'||map.sections)throw new Error('Invalid or unsupported source map');const inputs=[mapFile];for(const source of map.sources){if(typeof source!=='string'||/^[a-z]+:|^[\/\\]/i.test(source))throw new Error('Unsupported source map source');const relative=normalize(path.posix.join(path.posix.dirname(mapFile),map.sourceRoot||'',source));const file=localFile(root,relative);if(!files.has(file))throw new Error('Source map source outside tracked project scope');inputs.push(file);}return inputs;}catch{warnings.push(`source-map-unresolved:${bundle}`);return [];}
}

const BUILD_LIMITATIONS=['Build inspection verifies local bytes and source-map references, not that a build truthfully or completely represents source.','Ignored generated bundles are review suggestions only; unverified build completeness and unobserved dependencies require conservative fallback.'];
function inspectionConfig(root){const config=readConfig(root);if(Object.values(config.services||{}).some(service=>service?.probe!==undefined))throw new Error('Read-only build inspection cannot execute service probes; declare service version/env instead');return config;}
function artifactPath(root,file){if(typeof file!=='string'||file.split('/').some(segment=>['.git','node_modules','.tddswarm','.firecrawl'].includes(segment)))throw new Error('Build artifact path is unsupported');return localFile(root,file);}
/** Inspect explicitly selected bundles/maps without running a build or trusting its completeness. */
export function inspectBrowserBuildArtifacts(root,options={}){
  const config=inspectionConfig(root),requested=options.artifacts;
  if(!Array.isArray(requested)||!requested.length||requested.length>1000||new Set(requested).size!==requested.length)throw new Error('artifacts must be 1–1000 unique explicit local bundle paths');
  const provenance=snapshot(root,config),tracked=new Set(Object.keys(provenance.files)),artifacts=[];let total=0,sourceReferences=0;
  function bytes(file){const target=safePath(root,file);if(fs.statSync(target).size>MAX_BYTES)throw new Error('Build artifact exceeds size bound');const raw=fs.readFileSync(target);total+=raw.length;if(total>MAX_TOTAL)throw new Error('Build artifact total byte bound exceeded');return {raw,text:raw.toString('utf8')};}
  for(const requestedPath of requested){
    const file=artifactPath(root,requestedPath);if(artifacts.some(entry=>entry.path===file))throw new Error('Duplicate normalized build artifact path');if(!/\.(?:[cm]?js|css)$/.test(file))throw new Error('Build artifacts must be JavaScript or CSS bundles');
    const content=bytes(file),text=content.text,warnings=[],sources=[],entry={path:file,sha256:digest(content.raw),bytes:content.raw.length,generated:!tracked.has(file),map:null,sources,warnings};
    const reference=[...text.matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)/g)].at(-1)?.[1];
    if(!reference)warnings.push('build-source-map-missing');
    else if(/^[a-z]+:|^[\/\\]/i.test(reference)||reference.includes('?')||reference.includes('#'))warnings.push('build-source-map-reference-unsupported');
    else {
      try{
        const mapPath=artifactPath(root,normalize(path.posix.join(path.posix.dirname(file),reference))),content=bytes(mapPath);entry.map={path:mapPath,sha256:digest(content.raw),bytes:content.raw.length};
        const map=JSON.parse(content.text);if(map.version!==3||!Array.isArray(map.sources)||map.sources.length>2000||typeof(map.sourceRoot||'')!=='string'||map.sections)throw new Error('Unsupported build source map');
        sourceReferences+=map.sources.length;if(sourceReferences>10000)throw new Error('Build source reference count exceeds bound');
        if(/^[a-z]+:|^[\/\\]/i.test(map.sourceRoot||''))throw new Error('Unsupported build source root');
        for(const source of map.sources){if(typeof source!=='string'||/^[a-z]+:|^[\/\\]/i.test(source))throw new Error('Unsupported build source reference');const sourcePath=artifactPath(root,normalize(path.posix.join(path.posix.dirname(mapPath),map.sourceRoot||'',source)));if(!tracked.has(sourcePath))throw new Error('Build source is outside tracked scope');sources.push({path:sourcePath,sha256:provenance.files[sourcePath]});}
        entry.sources=[...new Map(sources.map(source=>[source.path,source])).values()].sort((a,b)=>a.path.localeCompare(b.path));if(!sources.length)warnings.push('build-source-map-has-no-sources');
      }catch(error){entry.sources=[];warnings.push(error.message==='Build artifact total byte bound exceeded'?error.message:'build-source-map-unresolved');if(['Build artifact total byte bound exceeded','Build source reference count exceeds bound'].includes(error.message))throw error;}
    }
    artifacts.push(entry);
  }
  const after=snapshot(root,config),check=freshness(provenance,after);if(!check.fresh)throw new Error('Source changed during build artifact inspection');
  // Generated outputs are excluded from ordinary source provenance, so read their bytes again explicitly.
  for(const entry of artifacts)for(const artifact of [entry,entry.map].filter(Boolean))if(digest(fs.readFileSync(safePath(root,artifact.path)))!==artifact.sha256)throw new Error('Artifact changed during inspection');
  return seal({schemaVersion:1,type:'browser-build-artifacts',provenance,configurationHash:digest(config),artifacts,totalBytes:total,reviewRequired:true,closedWorld:false,buildComplete:false,warnings:['unverified-build-completeness'],limitations:BUILD_LIMITATIONS});
}
export function validateBrowserBuildArtifacts(root,manifest){
  const config=inspectionConfig(root);
  if(typeof manifest==='string')manifest=JSON.parse(readBounded(safePath(root,manifest),MAX_TOTAL));verify(manifest,'browser-build-artifacts');
  if(!Array.isArray(manifest.artifacts)||!manifest.artifacts.length||manifest.artifacts.length>1000||manifest.closedWorld!==false||manifest.buildComplete!==false||manifest.reviewRequired!==true)throw new Error('Invalid build artifact manifest schema');
  const check=freshness(manifest.provenance,snapshot(root,config));if(!check.fresh||digest(config)!==manifest.configurationHash)throw new Error('Build artifact manifest is stale');
  const current=inspectBrowserBuildArtifacts(root,{artifacts:manifest.artifacts.map(entry=>entry.path)});
  if(digest(current.artifacts)!==digest(manifest.artifacts))throw new Error('Build artifact bytes or mapping references changed');
  return manifest;
}

/** Produces a review-only proposal. Applying observations never asserts closed-world completeness. */
export function proposeBrowserMappings(root,evidence,options={}){
  if(typeof evidence==='string')evidence=JSON.parse(readBounded(safePath(root,evidence),MAX_TOTAL));verify(evidence,'browser');if(!Array.isArray(evidence.observations)||evidence.observations.length>MAX_CASES||!Array.isArray(evidence.warnings)||evidence.warnings.length>MAX_CASES*2||typeof evidence.complete!=='boolean')throw new Error('Invalid browser evidence schema');
  const config=options.buildManifest?inspectionConfig(root):readConfig(root),check=freshness(evidence.provenance,snapshot(root,config));if(!check.fresh||digest(config)!==evidence.configurationHash)throw new Error('Browser evidence is stale');
  const roots=rootsFor(root,options.urlRoots||[]),files=new Set(listFiles(root)),warnings=[...evidence.warnings],routes={},caseMappings=[];const serverInputs=options.serverInputs||{};
  const buildManifest=options.buildManifest?validateBrowserBuildArtifacts(root,options.buildManifest):null,buildArtifacts=new Map((buildManifest?.artifacts||[]).map(entry=>[entry.path,entry]));if(buildManifest)warnings.push('unverified-build-completeness');
  if(typeof serverInputs!=='object'||Array.isArray(serverInputs)||Object.keys(serverInputs).length>1000)throw new Error('serverInputs must map bounded route paths to local paths');
  for(const [route,inputs]of Object.entries(serverInputs)){if(!route.startsWith('/')||route.includes('?')||route.includes('#')||!Array.isArray(inputs)||inputs.length>1000)throw new Error('Invalid server input mapping');for(const input of inputs){const file=localFile(root,input);if(!files.has(file))throw new Error('Server input outside tracked project scope');}}
  for(const observation of evidence.observations){const dependencies=new Set([observation.file]);const unresolved=[],generatedBuildSuggestions=[];
    for(const request of observation.requests){const mapped=requestFile(root,request.url,roots);if(mapped&&files.has(mapped)){dependencies.add(mapped);if(['script','stylesheet'].includes(request.type))for(const file of sourceMapInputs(root,mapped,files,warnings))dependencies.add(file);}else {const artifact=buildArtifacts.get(mapped);if(artifact){generatedBuildSuggestions.push({url:request.url,artifact:artifact.path,artifactHash:artifact.sha256,map:artifact.map,trackedSources:artifact.sources,warnings:artifact.warnings,reviewRequired:true,closedWorld:false});unresolved.push({url:request.url,type:request.type,reason:'generated-build-completeness-unverified'});warnings.push(...artifact.warnings);}else unresolved.push({url:request.url,type:request.type,reason:request.status>=400?'request-failed':'request-not-mapped'});}if(request.status>=400)warnings.push(`browser-request-failed:${request.type}`);}
    for(const routeURL of observation.routes){const parsed=url(routeURL),route=parsed.pathname;const knownOrigin=roots.some(entry=>entry.origin===parsed.origin);if(!knownOrigin)warnings.push(`external-browser-route:${observation.file}`);for(const input of knownOrigin?(serverInputs[route]||[]):[])dependencies.add(input);const entry=routes[route]||={tests:[],inputs:[]};entry.tests.push(observation.file);entry.inputs.push(...dependencies);}
    if(unresolved.length)warnings.push(`unmapped-browser-inputs:${observation.file}`);
    caseMappings.push({caseId:observation.caseId,nativeId:observation.nativeId,repeatEachIndex:observation.repeatEachIndex,file:observation.file,routes:observation.routes,dependencies:[...dependencies].sort(),generatedBuildSuggestions,sourceSuggestions:[...new Set(generatedBuildSuggestions.flatMap(entry=>entry.trackedSources.map(source=>source.path)))].sort(),unresolved});
  }
  for(const [route,entry]of Object.entries(routes)){entry.tests=[...new Set(entry.tests)].sort();entry.inputs=[...new Set(entry.inputs)].sort();if(config.browser?.routes?.[route])warnings.push(`manual-browser-route-preserved:${route}`);}
  const proposedRoutes=Object.fromEntries(Object.entries(routes).filter(([route])=>!Object.hasOwn(config.browser?.routes||{},route)));
  return seal({schemaVersion:1,type:'browser-mapping-proposal',evidenceHash:digest(evidence),provenance:evidence.provenance,configurationHash:evidence.configurationHash,observationsComplete:evidence.complete,closedWorld:false,reviewRequired:true,caseMappings,proposed:{browser:{routes:proposedRoutes}},manualRoutes:Object.keys(config.browser?.routes||{}).sort(),buildManifestHash:buildManifest?digest(buildManifest):null,buildManifest,warnings:[...new Set(warnings)],policy:{urlRoots:roots,serverInputs},limitations:[...LIMITATIONS,...(buildManifest?BUILD_LIMITATIONS:[])]});
}

/** AST-supported SDK imports only. Returns edits for an improvement branch; never writes tests. */
export async function proposeBrowserInstrumentation(root,options={}){
  const {default:ts}=await import('typescript');const config=readConfig(root),provenance=snapshot(root,config);
  const files=options.files||discover(root,config).files;if(!Array.isArray(files)||files.length>MAX_CASES)throw new Error('Instrumentation files must be a bounded array');
  const patches=[],rejected=[];
  for(const file of files){
    try{
      const target=safePath(root,file),original=readBounded(target),kind=/\.tsx$/.test(file)?ts.ScriptKind.TSX:/\.jsx$/.test(file)?ts.ScriptKind.JSX:/\.[cm]?ts$/.test(file)?ts.ScriptKind.TS:ts.ScriptKind.JS;
      const source=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true,kind);if(source.parseDiagnostics.length)throw new Error('syntax-errors');
      const imports=source.statements.filter(ts.isImportDeclaration),specifiers=[];
      let sawCode=false;for(const statement of source.statements){if(ts.isImportDeclaration(statement)){if(sawCode)throw new Error('imports-after-executable-code');}else if(!ts.isImportEqualsDeclaration(statement)&&!ts.isInterfaceDeclaration(statement)&&!ts.isTypeAliasDeclaration(statement)&&!(ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression)))sawCode=true;}
      if(imports.some(entry=>entry.moduleSpecifier.text==='testlore/playwright'))throw new Error('already-instrumented');
      for(const entry of imports){if(entry.moduleSpecifier.text!=='@playwright/test')continue;const clause=entry.importClause;if(!clause||clause.isTypeOnly||!clause.namedBindings||!ts.isNamedImports(clause.namedBindings))continue;for(const item of clause.namedBindings.elements)if((item.propertyName?.text||item.name.text)==='test'&&!item.isTypeOnly)specifiers.push(item);}
      if(specifiers.length!==1)throw new Error('requires-one-static-sdk-test-import');
      const item=specifiers[0],name=item.name.text,base='__testloreBaseTest',factory='__testloreCreateBrowserTest';
      const identifiers=new Set();function visit(node){if(ts.isIdentifier(node))identifiers.add(node.text);ts.forEachChild(node,visit);}visit(source);
      if(identifiers.has(base)||identifiers.has(factory))throw new Error('instrumentation-identifier-collision');
      const start=item.getStart(source),end=item.end,insertion=imports.at(-1).end;
      const edits=[{start,end,text:`test as ${base}`},{start:insertion,end:insertion,text:`\nimport {createBrowserTest as ${factory}} from 'testlore/playwright';\nconst ${name} = ${factory}(${base});`}].sort((a,b)=>b.start-a.start);
      let content=original;for(const edit of edits)content=content.slice(0,edit.start)+edit.text+content.slice(edit.end);
      patches.push({path:file,originalHash:digest(original),content,proposedHash:digest(content)});
    }catch(error){rejected.push({file,reason:error.message});}
  }
  return seal({schemaVersion:1,type:'browser-instrumentation-proposal',provenance,configurationHash:digest(config),reviewRequired:true,closedWorld:false,requiresLocalDependency:'testlore',files:patches,rejected,limitations:['Only one static named test import from @playwright/test is supported. Existing fixture modules, CommonJS and namespace imports require a manual fixture extension.','Generated edits require branch validation, review, and a local TestLore dependency. They do not alter existing assertions or confer closed-world authority.']});
}
