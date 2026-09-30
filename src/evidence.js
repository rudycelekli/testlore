import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { snapshot, freshness, digest } from './provenance.js';
import { readConfig, safePath, normalize } from './files.js';
import { adapterFor } from './execution.js';
import { buildGraph } from './graph.js';
import { declaredInputs, serviceInputs, rememberServices } from './inputs.js';

const ratio = (covered,total) => total ? 100*covered/total : null;
const metric = values => ({covered:values.filter(v=>v>0).length,total:values.length,percentage:ratio(values.filter(v=>v>0).length,values.length)});
export function coverageMetrics(report) {
  if (report.total && ['lines','statements','functions','branches'].every(k=>report.total[k] && Number.isFinite(report.total[k].covered) && Number.isFinite(report.total[k].total))) {
    return Object.fromEntries(['lines','statements','functions','branches'].map(k=>{
      const {covered,total}=report.total[k];if(covered<0||total<0||covered>total)throw new Error('Invalid coverage counters');return [k,{covered,total,percentage:ratio(covered,total)}];
    }));
  }
  const statements=[],branches=[],functions=[],lines=new Map();
  for(const [file,entry] of Object.entries(report)) {
    if(!entry || !entry.s || !entry.b || !entry.f || !entry.statementMap)throw new Error('Expected Istanbul final or summary coverage JSON');
    for(const [id,value] of Object.entries(entry.s)) {
      if(!Number.isFinite(value)||value<0)throw new Error('Invalid coverage count');statements.push(value);
      const line=entry.statementMap[id]?.start?.line;if(Number.isInteger(line))lines.set(`${file}:${line}`,Math.max(lines.get(`${file}:${line}`)||0,value));
    }
    for(const value of Object.values(entry.b)) {if(!Array.isArray(value)||value.some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid branch coverage');branches.push(...value);}
    for(const value of Object.values(entry.f)){if(!Number.isFinite(value)||value<0)throw new Error('Invalid function coverage');functions.push(value);}
  }
  return {lines:metric([...lines.values()]),statements:metric(statements),functions:metric(functions),branches:metric(branches)};
}
export function mutationMetrics(report) {
  if(!report.files||typeof report.files!=='object'||Array.isArray(report.files))throw new Error('Expected Stryker mutation JSON report with files');
  const counts={Killed:0,Timeout:0,Survived:0,NoCoverage:0,CompileError:0,RuntimeError:0,Ignored:0,Pending:0};
  for(const entry of Object.values(report.files)) {
    if(!Array.isArray(entry?.mutants))throw new Error('Missing mutation list');
    for(const mutant of entry.mutants) {if(!Object.hasOwn(counts,mutant.status))throw new Error(`Unknown mutant status: ${mutant.status}`);counts[mutant.status]++;}
  }
  const valid=counts.Killed+counts.Timeout+counts.Survived+counts.NoCoverage;
  return {counts,valid,detected:counts.Killed+counts.Timeout,score:ratio(counts.Killed+counts.Timeout,valid),complete:counts.Pending===0,excluded:counts.CompileError+counts.RuntimeError+counts.Ignored};
}
export function ingestQuality(root, type, reportPath, options = {}) {
  if(!['coverage','mutation'].includes(type))throw new Error('Evidence type must be coverage or mutation');
  // Import only reports produced alongside a pre-run snapshot, not an arbitrary stale report rebound to today's source.
  if(!options.provenance)throw new Error('A pre-run provenance file is required; run snapshot before measuring quality');
  const provenance=typeof options.provenance==='string'?JSON.parse(fs.readFileSync(path.resolve(root,options.provenance),'utf8')):options.provenance;
  const current=snapshot(root,readConfig(root));const check=freshness(provenance,current);
  if(!check.fresh)throw new Error(`Quality evidence source changed: ${check.reasons.join(', ')}`);
  const raw=fs.readFileSync(path.resolve(root,reportPath),'utf8');const report=JSON.parse(raw);
  const metrics=type==='coverage'?coverageMetrics(report):mutationMetrics(report);
  const record={schemaVersion:1,type,provenance,reportHash:digest(raw),createdAt:new Date().toISOString(),scope:options.scope||'Imported report scope; see raw artifact',metrics};
  const dir=safePath(root,'.tddswarm/evidence/quality');fs.mkdirSync(dir,{recursive:true});
  record.integrity=digest(record);
  fs.writeFileSync(path.join(dir,`${type}.json`),JSON.stringify(record,null,2));
  fs.writeFileSync(path.join(dir,`${type}.raw.json`),raw);
  return record;
}
export function qualityEvidence(root) {
  const current=snapshot(root,readConfig(root));const result={};
  for(const type of ['coverage','mutation','stability']) {
    const file=safePath(root,`.tddswarm/evidence/quality/${type}.json`);
    if(!fs.existsSync(file)){result[type]={measured:false,reason:'not-measured'};continue;}
    try {
      const record=JSON.parse(fs.readFileSync(file,'utf8'));
      const {integrity,...payload}=record;
      if(record.type!==type||!integrity||integrity!==digest(payload))throw new Error('Evidence integrity mismatch');
      if(type!=='stability'&&record.reportHash!==digest(fs.readFileSync(safePath(root,`.tddswarm/evidence/quality/${type}.raw.json`),'utf8')))throw new Error('Raw evidence changed');
      const check=freshness(record.provenance,current);
      const eligible=type==='coverage'?(record.metrics?.lines?.total>0||record.metrics?.statements?.total>0):type==='mutation'?record.metrics?.valid>0:record.metrics?.identities>0;
      result[type]={...record,eligible,measured:eligible&&check.fresh && record.complete!==false && record.metrics?.complete!==false,fresh:check.fresh,reasons:check.reasons};
    } catch(error){result[type]={measured:false,reason:'invalid-evidence',error:error.message};}
  }
  return result;
}
export async function measureStability(root, options = {}) {
  const {execute}=await import('./execution.js');const config=readConfig(root);
  const repeat=Number(options.repeat||5);if(!Number.isInteger(repeat)||repeat<2||repeat>50)throw new Error('repeat must be 2–50');
  const graph=buildGraph(root);if(!graph.tests.length)throw new Error('No discovered tests');
  const before=snapshot(root,config);const rounds=[];
  for(let i=0;i<repeat;i++)rounds.push(execute(root,graph.tests,config,{capture:true}));
  const identities=[...new Set(rounds.flatMap(r=>(r.tests||[]).map(t=>t.id)))];
  const observed=identities.map(id=>{const results=rounds.map(r=>(r.tests||[]).find(t=>t.id===id));const statuses=results.map(r=>r?.status||'missing');return {id,statuses,unstable:statuses.includes('passed')&&statuses.includes('failed'),complete:!statuses.includes('missing')};});
  const check=freshness(before,snapshot(root,config));
  const record={schemaVersion:1,type:'stability',provenance:before,complete:graph.discovery?.complete!==false&&check.fresh&&rounds.every(r=>r.complete)&&observed.every(t=>t.complete)&&observed.length>0&&rounds.every(r=>r.tests.some(t=>['passed','failed'].includes(t.status))),repeat,scope:graph.tests,metrics:{unstable:observed.filter(t=>t.unstable).length,identities:observed.length,observed},rounds,limitations:['Observed outcomes across these runs, not a guarantee of future stability.'],createdAt:new Date().toISOString()};
  record.integrity=digest(record);
  const dir=safePath(root,'.tddswarm/evidence/quality');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'stability.json'),JSON.stringify(record,null,2));return record;
}
export async function captureRuntime(root, options = {}) {
  if(options.report)return ingestRuntime(root,options.report,options);
  const {execute}=await import('./execution.js');const config=readConfig(root);const graph=buildGraph(root);
  const adapter=adapterFor(config);
  if(adapter!=='node')throw new Error('Built-in runtime capture requires Node; use capture --report for other runners using the evidence protocol');
  if(!graph.tests.length)throw new Error('No discovered tests for runtime capture');
  const provenance=snapshot(root,config);const inputs=serviceInputs(root,config);const declarations=declaredInputs(config);const observations={};const results=[];
  const captureId=randomUUID();const rootReal=fs.realpathSync(root);
  for(let i=0;i<graph.tests.length;i++) {
    const test=graph.tests[i];const dir=safePath(root,`.tddswarm/runtime/${captureId}/${i}`);fs.mkdirSync(dir,{recursive:true});
    const traceFile=path.join(dir,'reads');
    const hook=fileURLToPath(new URL('./runtime-hook.cjs',import.meta.url));
    const execConfig={...config,env:{...config.env,NODE_V8_COVERAGE:dir,TDDSWARM_TRACE_ROOT:rootReal,TDDSWARM_TRACE_FILE:traceFile,NODE_OPTIONS:`${config.env?.NODE_OPTIONS||process.env.NODE_OPTIONS||''} --require ${JSON.stringify(hook)}`.trim()}};
    const result=execute(root,[test],execConfig,{capture:true});results.push({test,...result});
    const deps=new Set([test,...(declarations[test]||[])]);let seenCoverage=false,seenTrace=false;
    for(const file of fs.readdirSync(dir).filter(f=>f.startsWith('coverage-')&&f.endsWith('.json'))) {
      const covered=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
      for(const script of covered.result||[]) {
        if(!script.url.startsWith('file:'))continue;
        let absolute;try{absolute=fs.realpathSync(fileURLToPath(script.url));}catch{continue;}
        if(absolute.startsWith(rootReal+path.sep)) {
          const relative=normalize(path.relative(rootReal,absolute));if(!relative.split('/').includes('node_modules')&&graph.files.includes(relative)){deps.add(relative);seenCoverage=true;}
        }
      }
    }
    const traces=fs.readdirSync(dir).filter(f=>f.startsWith('reads-')&&f.endsWith('.json'));
    for(const file of traces){const trace=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));seenTrace=true;for(const dep of trace.files||[])if(graph.files.includes(dep))deps.add(dep);}
    observations[test]={dependencies:[...deps].sort(),complete:result.exitCode===0&&result.complete&&seenCoverage&&seenTrace};
  }
  const check=freshness(provenance,snapshot(root,config));
  const afterInputs=serviceInputs(root,config);
  const inputStable=!afterInputs.warnings.length&&digest(inputs.values)===digest(afterInputs.values);
  const record={schemaVersion:1,type:'runtime',captureId,provenance,inputs:inputs.values,tests:graph.tests,observations,complete:graph.discovery?.complete!==false&&check.fresh&&inputStable&&!inputs.warnings.length&&Object.values(observations).every(o=>o.complete),results,createdAt:new Date().toISOString(),limitations:['Observed module and file-read dependencies for these executions; network/database dependencies require declared service versions.','Using runtime observations to resolve dynamic uncertainty requires an explicit closedWorld policy.']};
  record.integrity=digest(record);
  fs.mkdirSync(safePath(root,'.tddswarm/evidence'),{recursive:true});fs.writeFileSync(safePath(root,'.tddswarm/evidence/runtime.json'),JSON.stringify(record,null,2));
  if(record.complete)rememberServices(root,config,graph.tests,inputs.values);
  return record;
}
export function runtimeEvidence(root,graph,changed,config) {
  if(!config.runtime?.enabled)return {usable:false,reason:'runtime-disabled'};
  try {
    const record=JSON.parse(fs.readFileSync(safePath(root,'.tddswarm/evidence/runtime.json'),'utf8'));
    const {integrity,...payload}=record;
    if(!integrity||integrity!==digest(payload))return {usable:false,reason:'invalid-runtime-evidence'};
    if(record.reportHash&&record.reportHash!==digest(fs.readFileSync(safePath(root,'.tddswarm/evidence/runtime.raw.json'),'utf8')))return {usable:false,reason:'invalid-runtime-evidence'};
    if(record.reportHash&&record.reportHash!==digest(fs.readFileSync(safePath(root,'.tddswarm/evidence/runtime.raw.json'),'utf8')))return {usable:false,reason:'invalid-runtime-evidence'};
    if(record.type!=='runtime'||!record.complete||!record.observations||!Array.isArray(record.tests))return {usable:false,reason:'incomplete-runtime-evidence'};
    if(record.tests.length!==graph.tests.length||graph.tests.some(t=>!record.tests.includes(t)||record.observations[t]?.complete!==true||!Array.isArray(record.observations[t]?.dependencies)))return {usable:false,reason:'runtime-scope-changed'};
    const check=freshness(record.provenance,snapshot(root,config),{changed,allowChangedInputs:true});
    if(!check.fresh)return {usable:false,reason:'stale-runtime-evidence',reasons:check.reasons};
    // Changed tests or loader/config code still select via known edges; do not treat evidence as a proof of all possible behavior.
    return {usable:true,record};
  }catch(error){return {usable:false,reason:error.code==='ENOENT'?'runtime-evidence-missing':'invalid-runtime-evidence'};}
}

export function ingestRuntime(root, reportPath, options = {}) {
  const config=readConfig(root);const graph=buildGraph(root);
  const raw=fs.readFileSync(path.resolve(root,reportPath),'utf8');const report=JSON.parse(raw);
  if(!options.provenance)throw new Error('A pre-run provenance file is required');
  const provenance=typeof options.provenance==='string'?JSON.parse(fs.readFileSync(path.resolve(root,options.provenance),'utf8')):options.provenance;
  const check=freshness(provenance,snapshot(root,config));
  if(!check.fresh)throw new Error(`Runtime evidence source changed: ${check.reasons.join(', ')}`);
  if(report.schemaVersion!==1||report.type!=='runtime'||report.complete!==true||!Array.isArray(report.tests)||!report.observations)throw new Error('Expected complete runtime protocol report');
  if(graph.discovery?.complete===false||report.tests.length!==graph.tests.length||new Set(report.tests).size!==graph.tests.length||graph.tests.some(t=>!report.tests.includes(t)))throw new Error('Runtime report must cover the complete discovered scope');
  const declarations=declaredInputs(config);const inputs=serviceInputs(root,config);
  if(inputs.warnings.length||digest(report.inputs||{})!==digest(inputs.values))throw new Error('Runtime service versions missing or changed');
  const observations={};
  for(const test of graph.tests){
    const observation=report.observations[test];
    if(observation?.complete!==true||!Array.isArray(observation.dependencies)||observation.dependencies.some(d=>typeof d!=='string'||(!graph.files.includes(d)&&!Object.hasOwn(inputs.values,d))))throw new Error(`Invalid runtime observation for ${test}`);
    observations[test]={complete:true,dependencies:[...new Set([test,...observation.dependencies,...(declarations[test]||[])])].sort()};
  }
  const record={schemaVersion:1,type:'runtime',captureId:randomUUID(),provenance,inputs:inputs.values,tests:graph.tests,observations,complete:true,reportHash:digest(raw),createdAt:new Date().toISOString(),limitations:['Imported producer attestations are trusted; TDDSwarm does not prove trace completeness.','Runtime observations supplement static dependencies; closedWorld policy is explicit.']};
  record.integrity=digest(record);
  const dir=safePath(root,'.tddswarm/evidence');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'runtime.json'),JSON.stringify(record,null,2));
  fs.writeFileSync(path.join(dir,'runtime.raw.json'),raw);
  rememberServices(root,config,graph.tests,inputs.values);
  return record;
}
