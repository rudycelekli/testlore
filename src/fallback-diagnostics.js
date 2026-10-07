import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readConfig,safePath} from './files.js';
import {digest,snapshot,freshness} from './provenance.js';
import {routingProposals,validateRoutingProposals} from './routing-proposals.js';
import {qualifyRoutingMappings} from './mapping-qualification.js';

const MAX_ITEMS=10000,MAX_BYTES=512*1024,MAX_EDGES=25000;
const producer=()=>({module:'fallback-diagnostics.js',sha256:digest(fs.readFileSync(fileURLToPath(import.meta.url)))});
const LIMITATIONS=[
  'A missing dependency path is an evidence gap, not proof that a change cannot affect a test.',
  'Literal references are review hypotheses; strings can describe fixtures, snapshots or routes without reading this project input.',
  'Passing full/subset observations qualify this scenario only. They do not close dependency uncertainty or enable selective execution.'
];
const ACTIONS={
  'global-configuration-changed':['configuration','Keep the full run. Changed global configuration can alter discovery, resolution or every test.'],
  'change-without-test-evidence':['unmapped-input','Review each unmapped input, its actual consumers and suite scope. Add evidenced edges or add the missing verification suite.'],
  'unmapped-or-deleted-input':['deleted-or-untracked-input','Recover baseline consumers for removed inputs; do not treat disappearance as independence.'],
  'dependency-graph-incomplete':['global-uncertainty','Repair the global resolver/discovery evidence; adding local edges cannot establish completeness.'],
  'discovery-incomplete':['discovery','Repair native inventory before permitting any omission.'],
  'external-service-evidence-unavailable':['service','Declare all consumers and a trustworthy service revision signal; do not use an endpoint or credential as a version.'],
  'periodic-full-run':['policy','Retain the configured periodic full verification.'],
  'explicit-full-run':['policy','Honor the requested full verification.'],
  'git-baseline-unavailable':['baseline','Restore an immutable baseline before reviewing selective execution.']
};
function bounded(values,label){if(!Array.isArray(values)||values.length>MAX_ITEMS)throw new Error(`Invalid or over-bound ${label}`);return values;}
function strings(values,label){bounded(values,label);if(values.some(value=>typeof value!=='string'||!value||value.length>4096||value.includes('\0')))throw new Error(`Invalid ${label}`);return values;}
function projectPath(value){safePath('/testlore-project',value);if(value.split('/').some(part=>!part||part==='.'||['.git','node_modules','.tddswarm'].includes(part)))throw new Error('Invalid diagnostic project path');return value;}
function checked(selection){
  if(!selection||selection.schemaVersion!==1||!['full','affected','none','policy'].includes(selection.mode))throw new Error('Expected a native selection receipt');
  for(const key of ['changed','ignored','selected','reasons'])strings(selection[key],key);
  selection.changed.forEach(projectPath);selection.ignored.forEach(projectPath);selection.selected.forEach(projectPath);
  if(new Set(selection.changed).size!==selection.changed.length||new Set(selection.selected).size!==selection.selected.length)throw new Error('Duplicate diagnostic paths');
  if(selection.ignored.some(file=>!selection.changed.includes(file)))throw new Error('Ignored input is outside changed scope');
  bounded(selection.decisions,'decisions');bounded(selection.warnings,'warnings');
  const tests=new Set();let pathEdges=0;
  for(const decision of selection.decisions){
    projectPath(decision.test);if(tests.has(decision.test)||typeof decision.selected!=='boolean')throw new Error('Invalid diagnostic decision');tests.add(decision.test);
    strings(decision.reasons,'decision reasons');bounded(decision.paths,'decision paths');
    for(const chain of decision.paths){strings(chain,'dependency path');if(!chain.length||chain[0]!==decision.test)throw new Error('Invalid dependency path origin');chain.forEach(projectPath);pathEdges+=chain.length;if(pathEdges>MAX_EDGES)throw new Error('Diagnostic dependency edge bound exceeded');}
  }
  if(selection.total!==tests.size||selection.omitted!==tests.size-selection.selected.length||digest(selection.selected)!==digest(selection.decisions.filter(entry=>entry.selected).map(entry=>entry.test)))throw new Error('Selection scope does not match decisions');
  if(selection.mode==='full'&&selection.selected.length!==tests.size)throw new Error('Full fallback cannot omit retained tests');
  for(const warning of selection.warnings){if(!warning||typeof warning.reason!=='string'||warning.reason.length>4096||!['global','test-closure','unreachable-source'].includes(warning.scope))throw new Error('Invalid scoped graph warning');projectPath(warning.file);if(warning.tests!==undefined){strings(warning.tests,'warning tests');warning.tests.forEach(projectPath);}}
  return selection;
}
const category=input=>/\.(?:md|txt|rst)$/.test(input)?'document-or-contract':/\.(?:html|css|scss|sass|less|svg|png|jpe?g|webp|woff2?)$/.test(input)?'browser-or-asset':/\.(?:sql|sh)$/.test(input)?'database-or-command':'source-or-configuration';

/** Offline receipt inspection. No source freshness or omitted-test safety is asserted. */
export function diagnoseFallbackSelection(selection){
  checked(selection);
  const active=selection.changed.filter(file=>!selection.ignored.includes(file));
  const changes=active.map(input=>{
    const consumers=selection.decisions.filter(entry=>entry.paths.some(chain=>chain.at(-1)===input)).map(entry=>entry.test);
    return {input,category:category(input),knownConsumers:consumers,mapped:consumers.length>0,reason:consumers.length?'retained-dependency-path':'no-retained-consumer-evidence',nextAction:consumers.length?'Retain the evidenced consumers and their uncertainty policies.':'Review actual consumers and whether this suite can verify the changed behavior; do not fabricate a dependency to a convenient test.'};
  });
  const warnings=selection.warnings.map(entry=>({code:entry.reason.split(':')[0],scope:entry.scope,file:entry.file,tests:entry.tests||[],effect:entry.scope==='global'?'full-fallback':entry.scope==='test-closure'?'retain-uncertain-consumers':'unreachable-under-current-graph',nextAction:entry.scope==='unreachable-source'?'Review suite scope; this warning did not itself cause full fallback.':'Review runtime, browser, service or resolver evidence; local edge additions do not remove this uncertainty.'}));
  return {schemaVersion:1,type:'fallback-diagnostic-summary',selectionHash:digest(selection),mode:selection.mode,total:selection.total,selected:selection.selected.length,omitted:selection.omitted,freshnessVerified:false,
    causes:selection.reasons.map(code=>{const [kind,nextAction]=ACTIONS[code]||['other-conservative-gate','Repair the retained gate before narrowing verification.'];return {code,kind,nextAction};}),changes,warnings,
    omissions:selection.decisions.filter(entry=>!entry.selected).map(entry=>({test:entry.test,reasons:entry.reasons,explanation:'No retained dependency path or required execution policy selected this test. This is a planning explanation, not an independent safety proof.'})),
    retainedUncertainty:selection.decisions.filter(entry=>entry.selected&&entry.reasons.includes('uncertain-dependency-closure')).map(entry=>entry.test),reviewRequired:true,applied:false,closedWorld:false,limitations:LIMITATIONS};
}

function rejectProbes(config){if(Object.values(config.services||{}).some(service=>service?.probe!==undefined))throw new Error('Fallback diagnostics cannot execute service probes');}
function literalHypotheses(root,selection,current){
  const gaps=new Set(diagnoseFallbackSelection(selection).changes.filter(entry=>!entry.mapped&&Object.hasOwn(current.files,entry.input)).map(entry=>entry.input));
  const entries=[],warnings=[];let bytes=0,edges=0;
  for(const decision of selection.decisions){
    const filename=safePath(root,decision.test),stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.size>MAX_BYTES){warnings.push({file:decision.test,reason:'literal-test-source-over-bound'});continue;}
    bytes+=stat.size;if(bytes>8*1024*1024){warnings.push({file:decision.test,reason:'literal-test-scan-total-over-bound'});break;}
    const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));let text;
    try{const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.ino!==stat.ino||opened.dev!==stat.dev||opened.size!==stat.size)throw new Error('Test source changed before diagnostic inspection');const data=Buffer.alloc(stat.size+1);let count=0,n;while(count<data.length&&(n=fs.readSync(fd,data,count,data.length-count,null))>0)count+=n;const after=fs.fstatSync(fd);if(count!==stat.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||digest(data.subarray(0,count))!==current.files[decision.test])throw new Error('Test source drift during diagnostic inspection');text=data.subarray(0,count).toString('utf8');}finally{fs.closeSync(fd);}
    const ast=ts.createSourceFile(decision.test,text,ts.ScriptTarget.Latest,true);if(ast.parseDiagnostics.length){warnings.push({file:decision.test,reason:'literal-test-parse-incomplete'});continue;}
    const inputs=new Map();
    function visit(node){if(ts.isStringLiteralLike(node)){
      const value=node.text;
      // Exact project-root/relative spellings only; basename matches are never inferred.
      for(const base of ['',path.posix.dirname(decision.test)]){
        if(!value||/[\\\0%?#]/.test(value)||/^[a-z][a-z\d+.-]*:/i.test(value)||path.posix.isAbsolute(value))continue;
        const input=path.posix.normalize(path.posix.join(base,value));if(gaps.has(input))inputs.set(input,ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1);
      }
    }ts.forEachChild(node,visit);}visit(ast);
    for(const [input,line]of inputs){if(++edges>MAX_EDGES)throw new Error('Literal diagnostic edge bound exceeded');entries.push({id:digest({test:decision.test,input,line}),source:decision.test,input,inputs:[input],tests:[decision.test],kind:'literal-test-input-hypothesis',evidence:{line,sourceHash:current.files[decision.test],inputHashes:{[input]:current.files[input]}},patch:{dependencies:{[decision.test]:[input]}},status:'review-required',authority:'proposal-only',closedWorld:false,explanation:'A literal in this test names this unmapped project input. Review the serving/reading path and assertions before treating it as a dependency.',limitations:LIMITATIONS});}
  }
  return {entries,warnings};
}

/** Current-source, review-only diagnostics. The caller supplies the existing native plan. */
export function fallbackDiagnostics(root,selection,{propose=true}={}){
  if(typeof propose!=='boolean')throw new Error('propose must be boolean');
  root=path.resolve(root);checked(selection);const config=readConfig(root);rejectProbes(config);
  const before=snapshot(root,config),check=freshness(selection.provenance,before);if(!check.fresh)throw new Error(`Selection is stale: ${check.reasons.join(', ')}`);
  const implementation=producer(),routing=propose?routingProposals(root):null,literals=propose?literalHypotheses(root,selection,before):{entries:[],warnings:[]};
  const after=snapshot(root,config);if(!freshness(before,after).fresh||digest(implementation)!==digest(producer()))throw new Error('Source or diagnostic producer changed while inspecting fallback');
  const payload={schemaVersion:1,type:'fallback-diagnostics',selection,summary:{...diagnoseFallbackSelection(selection),freshnessVerified:true},provenance:before,configurationHash:digest(config),producer:implementation,routing,literalHypotheses:literals.entries,warnings:literals.warnings,reviewRequired:true,applied:false,closedWorld:false,limitations:LIMITATIONS};
  return {...payload,integrity:digest(payload)};
}
export function validateFallbackDiagnostics(root,report){
  const {integrity,...payload}=report||{};if(report?.type!=='fallback-diagnostics'||report.schemaVersion!==1||integrity!==digest(payload)||digest(report.producer)!==digest(producer())||report.reviewRequired!==true||report.applied!==false||report.closedWorld!==false)throw new Error('Invalid fallback diagnostic integrity or authority');
  const config=readConfig(root);rejectProbes(config);if(report.configurationHash!==digest(config))throw new Error('Fallback diagnostic configuration changed');
  const check=freshness(report.provenance,snapshot(root,config));if(!check.fresh)throw new Error(`Fallback diagnostic is stale: ${check.reasons.join(', ')}`);
  const expected={...diagnoseFallbackSelection(report.selection),freshnessVerified:true};if(digest(expected)!==digest(report.summary))throw new Error('Fallback summary does not match retained selection');
  if(!freshness(report.selection.provenance,report.provenance).fresh)throw new Error('Diagnostic selection provenance changed');
  if(report.routing)validateRoutingProposals(root,report.routing);
  const expectedLiterals=report.routing?literalHypotheses(root,report.selection,report.provenance):{entries:[],warnings:[]};if(digest(expectedLiterals.entries)!==digest(report.literalHypotheses)||digest(expectedLiterals.warnings)!==digest(report.warnings))throw new Error('Diagnostic literal evidence changed');
  return {valid:true,reviewRequired:true,applied:false,closedWorld:false};
}

/** Independently challenge an explicit reviewed set; neither this API nor qualification writes configuration. */
export function qualifyFallbackHypotheses(root,report,{hypothesisIds,...options}={}){
  validateFallbackDiagnostics(root,report);strings(hypothesisIds,'reviewed hypothesis IDs');if(!hypothesisIds.length||new Set(hypothesisIds).size!==hypothesisIds.length)throw new Error('Select unique reviewed hypothesis IDs');
  const entries=report.literalHypotheses.filter(entry=>hypothesisIds.includes(entry.id));if(entries.length!==hypothesisIds.length)throw new Error('Unknown reviewed fallback hypothesis');
  const proposal={schemaVersion:1,type:'reviewed-fallback-literal-hypotheses',provenance:report.provenance,stable:true,applied:false,closedWorld:false,proposals:entries};
  const qualification=qualifyRoutingMappings(root,proposal,options);
  const {integrity:originalIntegrity,...payload}=qualification;
  const extended={...payload,originalQualificationIntegrity:originalIntegrity,fallbackDiagnosticIntegrity:report.integrity,hypothesisEvidence:'sealed-test-literals-explicitly-selected-by-caller; input completeness, semantic dependency and human review unverified'};
  return {...extended,integrity:digest(extended)};
}
