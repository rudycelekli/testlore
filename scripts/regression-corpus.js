#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pilot, validatePilotManifest, exportPilot } from '../src/pilot.js';
import { digest } from '../src/provenance.js';
import { git, safePath, TEST } from '../src/files.js';
import { readBoundedJson } from './evaluation-commitment.js';
import { fileIdentity, assertFileIdentities } from './worker-identity.js';

const read = file => readBoundedJson(file,16*1024*1024);
const repository = fileURLToPath(new URL('../',import.meta.url));
function captureIdentity() {
  const files=['scripts/regression-corpus.js','scripts/evaluation-commitment.js','scripts/worker-identity.js'], queue=['src'];
  while(queue.length){const directory=queue.pop();for(const name of fs.readdirSync(path.join(repository,directory)).sort()){const file=directory+'/'+name,stat=fs.lstatSync(path.join(repository,file));if(stat.isDirectory())queue.push(file);else if(stat.isFile())files.push(file);else throw new Error('Controller source inventory requires regular files');if(files.length+queue.length>256)throw new Error('Controller source inventory exceeded its bound');}}
  const bindings=files.map(file=>fileIdentity(path.join(repository,file))),node=fileIdentity(process.execPath,512*1024*1024);
  let sourceRevision=null,sourceTreeClean=null;try{sourceRevision=git(repository,['rev-parse','HEAD']).trim();sourceTreeClean=!git(repository,['status','--porcelain']).trim();}catch{}
  return {bindings,nodeBinding:node,public:{sourceRevision,sourceTreeClean,controllerNode:{version:process.version,sha256:node.sha256,bytes:node.bytes},implementationHashes:Object.fromEntries(files.map((file,index)=>[file,bindings[index].sha256])),identityScope:'Controller, all existing core source modules and controller Node binary bound by content hashes. Installed native framework dependencies, runtime children, environment and models are not fully attested.'}};
}
const signatures = run => JSON.stringify((run.tests || []).map(test => [test.id, test.file, test.name, test.status]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const named = run => run.complete === true && Array.isArray(run.tests) && run.tests.length > 0 && run.tests.every(test => ['passed','failed'].includes(test.status) && test.name !== '<file-load>');
const percentile = (values, p) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length * p)-1] : null;

export function validateCorpus(manifest) {
  const validated = validatePilotManifest(manifest?.pilot);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.labels) || manifest.labels.length !== validated.projects.reduce((n,p)=>n+p.changes.length,0)) throw new Error('Exactly one independent outcome label per declared change is required');
  const seen = new Set();
  for (const label of manifest.labels) {
    const project = validated.projects.find(project => project.name === label.project), change = project?.changes.find(change => change.name === label.change), key = `${label.project}/${label.change}`;
    if (!change || seen.has(key) || !Array.isArray(label.expectedFailureNames) || label.expectedFailureNames.length > 32 || label.expectedFailureNames.some(name=>typeof name!=='string'||!name||name==='<file-load>'||name.length>300) || new Set(label.expectedFailureNames).size !== label.expectedFailureNames.length || change.expectedFailure !== (label.expectedFailureNames.length > 0)) throw new Error('Labels need distinct bounded named assertion failures matching expectedFailure');
    seen.add(key);
    if (!Array.isArray(label.oracleFiles) || !label.oracleFiles.length || label.oracleFiles.length>32 || label.oracleFiles.some(file=>!file || !TEST.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || fileIdentity(safePath(project.root,file.path)).sha256!==file.sha256)) throw new Error('Bind existing native oracle files by source hash');
    if (change.kind !== 'history' && TEST.test(change.file)) throw new Error('A fault patch cannot modify its test oracle');
    if (change.kind === 'history' && change.expectedFailure) for (const file of label.oracleFiles) for (const revision of [change.baseRevision,change.headRevision]) if(digest(git(project.root,['show',`${revision}:${file.path}`]))!==file.sha256)throw new Error('Historical fault oracle must be unchanged in both revisions');
    if (!['authored','repository-history','public-bugfix-inversion'].includes(label.origin?.kind) || typeof label.origin.maintainer !== 'string' || !label.origin.maintainer.trim() || label.origin.maintainer.length > 200 || typeof label.origin.independenceNotes !== 'string' || !label.origin.independenceNotes.trim() || label.origin.independenceNotes.length > 2000) throw new Error('Declare honest origin, maintainer and oracle independence limits');
    if (label.origin.kind === 'repository-history' && change.kind !== 'history') throw new Error('Repository-history labels require immutable Git changes');
    if (label.origin.kind === 'public-bugfix-inversion' && (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(label.origin.repository || '') || !/^[a-f0-9]{40}$/.test(label.origin.fixRevision || '') || !/^[a-f0-9]{40}$/.test(label.origin.parentRevision || '') || !/^[a-f0-9]{64}$/.test(label.origin.fixedSourceHash || '') || !/^[a-f0-9]{64}$/.test(label.origin.buggySourceHash || '') || change.kind === 'history' || digest(change.before) !== label.origin.fixedSourceHash || digest(change.after) !== label.origin.buggySourceHash)) throw new Error('Public bugfix inversion requires pinned revisions and byte-matched full-source inverse patch');
  }
  return manifest;
}

/** Derive a fault-preservation decision from private native case evidence, never counts alone. */
export function assessCorpus(report, labels) {
  const changes = [], timing = { full: [], testLore: [], native: [] };
  for (const label of labels) {
    const project = report.projects?.find(project => project.name === label.project), change = project?.changes?.find(change => change.name === label.change);
    const trials = change?.trials || [], rows = [];
    for (let index=0; index<trials.length; index++) {
      const trial = trials[index]; let runs, error;
      try {
        const c = project.changes.indexOf(change), directory = path.join(report.output, project.name);
        runs = Object.fromEntries(['full','subset','native'].map(arm=>[arm, read(path.join(directory,`change-${c}-trial-${index}-${arm}.json`))]));
      } catch (failure) { error = failure.message; }
      const failures = runs?.full.tests?.filter(test=>test.status==='failed' && test.name!=='<file-load>') || [];
      const demonstrated = Boolean(runs && named(runs.full) && label.expectedFailureNames.every(name=>failures.some(test=>test.name===name && label.oracleFiles.some(file=>file.path===test.file))) && (label.expectedFailureNames.length || runs.full.exitCode===0));
      const emptyPassingSubset = runs?.subset.complete === true && runs.subset.exitCode === 0 && Array.isArray(runs.subset.tests) && runs.subset.tests.length === 0 && failures.length === 0;
      const preserved = Boolean(demonstrated && (named(runs.subset) || emptyPassingSubset) && failures.every(failure=>runs.subset.tests.some(test=>test.id===failure.id && test.name===failure.name && test.status==='failed')) && trial.valid && trial.casePreservation?.complete);
      rows.push({ demonstrated, preserved, error, signatures: runs ? Object.fromEntries(Object.entries(runs).map(([arm,run])=>[arm,signatures(run)])) : null });
      for (const [arm,key] of [['full','fullMs'],['testLore','testLoreMs'],['native','nativeMs']]) if (Number.isFinite(trial[key]) && trial[key]>=0) timing[arm].push(trial[key]);
    }
    const repeated = rows.length === report.repetitions && rows.length >= 2;
    const stable = repeated && rows.every(row=>row.signatures) && ['full','subset','native'].every(arm=>rows.every(row=>row.signatures[arm]===rows[0].signatures[arm]));
    changes.push({ origin: label.origin.kind, expectedFault: label.expectedFailureNames.length>0, expectedTrials:report.repetitions, completedTrials:rows.length, demonstratedTrials:rows.filter(row=>row.demonstrated).length, preservedTrials:rows.filter(row=>row.preserved).length, stable, qualified:stable&&rows.every(row=>row.preserved)&&!change?.error&&project?.sourceCheckoutUnchanged===true });
  }
  const trials = report.projects?.flatMap(project=>(project.changes||[]).flatMap(change=>change.trials||[])) || [];
  const requested = changes.reduce((n,change)=>n+change.expectedTrials,0), completed = changes.reduce((n,change)=>n+change.completedTrials,0);
  return { schemaVersion:1, kind:'regression-corpus-assessment', requestedTrials:requested, completedTrials:completed, uncompletedTrials:requested-completed, scenarios:changes.length, faultScenarios:changes.filter(change=>change.expectedFault).length, faultOpportunities:changes.filter(change=>change.expectedFault).reduce((n,change)=>n+change.expectedTrials,0), independentlyDemonstratedFaultTrials:changes.filter(change=>change.expectedFault).reduce((n,change)=>n+change.demonstratedTrials,0), preservedFaultTrials:changes.filter(change=>change.expectedFault).reduce((n,change)=>n+change.preservedTrials,0), stableScenarios:changes.filter(change=>change.stable).length, qualifiedScenarios:changes.filter(change=>change.qualified).length, fullFallbackTrials:trials.filter(trial=>trial.mode==='full').length, selectiveTrials:trials.filter(trial=>['affected','policy','none'].includes(trial.mode)).length, qualified:changes.length>0&&changes.some(change=>change.expectedFault)&&changes.every(change=>change.qualified), provenance: { authoredScenarios:changes.filter(change=>change.origin==='authored').length, repositoryHistoryScenarios:changes.filter(change=>change.origin==='repository-history').length, publicBugfixInversions:changes.filter(change=>change.origin==='public-bugfix-inversion').length, maintainerIndependenceVerified:false }, timing: Object.fromEntries(Object.entries(timing).map(([arm,values])=>[arm,{ observed:values.length,totalMs:values.reduce((n,v)=>n+v,0),p50Ms:percentile(values,.5),p95Ms:percentile(values,.95) }])), timingScope:'Per-arm native process execution and TestLore discovery/planning/execution/receipt work. Corpus orchestration and independent verification discovery excluded; separately report controller elapsed time. Shared OS/dependency caches are not flushed; repetitions are not independent projects.', limitations:['Named assertion failures are independently executed; labels and maintainer independence remain operator declarations.', 'No observed misses on this bounded corpus establishes universal recall. Passing scenarios alone do not qualify fault preservation.', 'Missing trials, unstable case identities/statuses and incomplete/module-load outcomes cannot qualify.', 'Raw test identities and labels remain private; this aggregate does not contain repository paths or case names.', 'No model calls, provider billing or generation/learning claim. Native and TestLore implementations are not fully runtime-attested.'] };
}

export function runCorpus(root, manifest, relative) {
  validateCorpus(manifest);
  const repetitions = manifest.pilot.repetitions ?? 3;
  if (!/^\.tddswarm\/pilots\/[A-Za-z0-9_-]+$/.test(relative)) throw new Error('Use a new .tddswarm/pilots/ALIAS directory');
  const output = path.join(root,relative); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.mkdirSync(output);
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  const started = performance.now(); let report, aggregate, identity;
  try {
    identity=captureIdentity();
    fs.writeFileSync(path.join(output,'implementation-identity.json'),JSON.stringify(identity.public,null,2),{flag:'wx',mode:0o600});
    report = pilot(root,manifest.pilot,{execute:true,output:relative+'/pilot'});
    aggregate = { ...assessCorpus(report,manifest.labels), corpusHash:digest(manifest), pilot:exportPilot(report), implementationIdentity:identity.public };
  } catch (error) {
    fs.writeFileSync(path.join(output,'controller-error.json'),JSON.stringify({error:error.message}),{flag:'wx',mode:0o600});
    try{report ||= read(path.join(output,'pilot/summary.json'));aggregate={...assessCorpus(report,manifest.labels),pilot:exportPilot(report)};}catch{aggregate={schemaVersion:1,kind:'regression-corpus-assessment',requestedTrials:manifest.labels.length*repetitions,completedTrials:null,uncompletedTrials:null,accountingIncomplete:true};}
    aggregate={...aggregate,qualified:false,error:'Controller failed; inspect the retained private receipt',corpusHash:digest(manifest),implementationIdentity:identity?.public||null};
  }
  aggregate.implementationUnchanged=false;
  if(identity)try{assertFileIdentities(identity.bindings);if(JSON.stringify(fileIdentity(process.execPath,512*1024*1024))!==JSON.stringify(identity.nodeBinding))throw new Error('Controller Node identity drift');aggregate.implementationUnchanged=true;}catch{aggregate.qualified=false;aggregate.controllerError='Controller implementation identity changed during measurement';}
  aggregate.controllerElapsedMs = Math.round(performance.now()-started);
  fs.writeFileSync(path.join(output,'assessment.json'),JSON.stringify(aggregate,null,2)+'\n',{flag:'wx',mode:0o600});
  return aggregate;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const args=process.argv.slice(2); if(args.length!==5||args[0]!=='--manifest'||args[2]!=='--output'||args[4]!=='--execute')throw new Error('Use --manifest private-corpus.json --output .tddswarm/pilots/NEW_ALIAS --execute');const result=runCorpus(process.cwd(),read(args[1]),args[3]);console.log(JSON.stringify(result,null,2));process.exitCode=result.qualified?0:1; } catch(error){console.error(error.message);process.exitCode=1;}
}
