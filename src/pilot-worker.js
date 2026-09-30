import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, safePath } from './files.js';
import { discover, execute, executeNativeRelated } from './execution.js';
import { plan, gitChanges } from './selector.js';
import { run, compareSubsetCases } from './runner.js';
import { snapshot, freshness } from './provenance.js';
import { inspectHistoricalChange, linkInstalledDependencies } from './pilot-history.js';

const { project, revision, repetitions, timeoutMs, directory } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = path.join(directory, 'workspace');
const receipt = { schemaVersion: 1, name: project.name, framework: project.config.adapter, scope: project.scope, revision, valid: false, changes: [] };
function command(cwd, argv) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env: process.env, encoding: 'utf8', shell: false, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${argv[0]} failed: ${result.error?.message || result.stderr}`);
}
function save(name, value) { fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value, null, 2)); }
const failureIds = run => (run.tests || []).filter(t => t.status === 'failed' && t.name !== '<file-load>').map(t => t.id);
function complete(run) { return run.complete && !(run.tests || []).some(t => t.name === '<file-load>') && ((run.exitCode === 0 && !failureIds(run).length) || (run.exitCode !== 0 && failureIds(run).length > 0)); }
try {
  command(directory, ['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--local', '--no-hardlinks', '--no-checkout', project.root, root]);
  command(root, ['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', revision]);
  receipt.dependencies = linkInstalledDependencies(project.root,root);
  const config = { ...project.config, runnerTimeoutMs: timeoutMs };
  function overlay() {
    fs.writeFileSync(path.join(root, 'tddswarm.config.json'), JSON.stringify(config));
    fs.appendFileSync(path.join(root, '.gitignore'), '\n.tddswarm/\nnode_modules\n');
    command(root, ['git', '-c', 'core.hooksPath=/dev/null', 'add', '-f', '--', 'tddswarm.config.json', '.gitignore']);
  }
  function checkout(sha) {
    command(root, ['git', '-c', 'core.hooksPath=/dev/null', 'reset', '--hard', sha]);
    command(root, ['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', sha]);
    fs.rmSync(path.join(root, '.tddswarm'), {recursive:true, force:true});
    // Remove untracked files produced by earlier tests, but preserve shared dependencies.
    command(root, ['git', 'clean', '-fdx', '-e', 'node_modules']);
    overlay();
  }
  function baselineAt(sha, label) {
    checkout(sha);
    command(root, ['git', '-c', 'core.hooksPath=/dev/null', 'add', '-f', '--', 'tddswarm.config.json', '.gitignore']);
    command(root, ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=TestLore Local Pilot', '-c', 'user.email=pilot@localhost', 'commit', '-m', 'Local pilot configuration']);
    const base = git(root, ['rev-parse', 'HEAD']).trim(), before = snapshot(root, config);
    const discovery = discover(root, config); save(label+'-discovery', discovery);
    if (!discovery.complete || !discovery.files.length) throw new Error('Native discovery is incomplete or empty');
    const baseline = execute(root, discovery.files, config, {capture:true, timeoutMs}); save(label+'-baseline', baseline);
    if (!complete(baseline) || baseline.exitCode !== 0 || !baseline.tests.some(t => t.status === 'passed') || !freshness(before, snapshot(root, config)).fresh) throw new Error('Baseline must pass with complete, stable named case outcomes');
    return {base, summary:{revision:sha, files:discovery.files.length, cases:baseline.tests.length, skipped:baseline.tests.filter(t=>t.status==='skipped').length, durationMs:baseline.durationMs}};
  }
  let patchBaseline;
  for (let c = 0; c < project.changes.length; c++) {
    const change = project.changes[c];
    const changes = { name: change.name, kind: change.kind || 'patch', expectedFailure: change.expectedFailure, trials: [] }; receipt.changes.push(changes);
    let base;
    try {
      if (change.kind === 'history') {
        changes.history = inspectHistoricalChange(project.root, change, revision);
        if (!changes.history.dependencyCompatible) throw new Error(changes.history.rejection);
        const baseline = baselineAt(change.baseRevision, `change-${c}`);
        base = baseline.base; changes.baseline = baseline.summary;
        checkout(change.headRevision);
      } else {
        if (!patchBaseline) patchBaseline = baselineAt(revision, 'patch');
        base = patchBaseline.base; receipt.baseline = patchBaseline.summary;
        checkout(base);
        // checkout() appends ignore lines; restore the exact baseline overlay for patch comparisons.
        command(root, ['git', 'checkout', base, '--', '.gitignore', 'tddswarm.config.json']);
        const file = safePath(root, change.file), source = fs.readFileSync(file, 'utf8');
        if (source.split(change.before).length !== 2) throw new Error('Isolated patch precondition changed');
        fs.writeFileSync(file, source.replace(change.before, ()=>change.after));
      }
      for (let r = 0; r < repetitions; r++) {
        const trialName = `change-${c}-trial-${r}`;
        const collectionStart=performance.now(),currentDiscovery=discover(root,config),verificationDiscoveryMs=Math.round(performance.now()-collectionStart);
        save(trialName+'-discovery',currentDiscovery);
        if(!currentDiscovery.complete||!currentDiscovery.files.length)throw new Error('Current native full scope is incomplete or empty');
        const before=snapshot(root,config),changeset=gitChanges(root,base);
        const nativeAvailable=['vitest','jest'].includes(config.adapter);
        changes.changedPaths=changeset.changed;
        const methods=['full','subset','native'],offset=(c+r)%3,order=[...methods.slice(offset),...methods.slice(0,offset)];
        const runs={};let selection,planningMs,testLoreMs;
        // Each arm receives identical pre-trial history; previous defects cannot bias routing.
        const metadata=path.join(root,'.tddswarm');fs.mkdirSync(metadata,{recursive:true});
        const history=new Map(fs.readdirSync(metadata).filter(file=>/^history.*\.json$/.test(file)).map(file=>[file,fs.readFileSync(path.join(metadata,file))]));
        for(const mode of order){
          for(const file of fs.readdirSync(metadata).filter(file=>/^history.*\.json$/.test(file)))fs.rmSync(path.join(metadata,file));
          for(const [file,content]of history)fs.writeFileSync(path.join(metadata,file),content);
          if(mode==='subset'){
            const started=performance.now();runs.subset=run(root,{base,capture:true,selective:true,timeoutMs});testLoreMs=Math.round(performance.now()-started);
            selection=runs.subset.plan;
            if (runs.subset.executed === false && runs.subset.exitCode === 0 && !runs.subset.error && selection?.selected.length === 0) runs.subset = {...runs.subset, complete:true, tests:[], executedFiles:[], durationMs:0};
            planningMs=runs.subset.timings?.planningMs??testLoreMs;
            if(!selection)throw new Error('TestLore did not return a decision');save(trialName+'-plan',selection);
          }else if(mode==='native')runs.native=nativeAvailable?executeNativeRelated(root,changeset.changed,config,{capture:true,timeoutMs}):{...execute(root,currentDiscovery.files,config,{capture:true,timeoutMs}),selector:'native-full-no-related-selector'};
          else runs.full=execute(root,currentDiscovery.files,config,{capture:true,timeoutMs});
          save(trialName+'-'+mode,runs[mode]);
        }
        const after=snapshot(root,config),fullIds=failureIds(runs.full),subsetIds=failureIds(runs.subset),nativeIds=failureIds(runs.native);
        const missed=fullIds.filter(id=>!subsetIds.includes(id)),unexpected=subsetIds.filter(id=>!fullIds.includes(id));
        const nativeMissed=fullIds.filter(id=>!nativeIds.includes(id)),nativeUnexpected=nativeIds.filter(id=>!fullIds.includes(id));
        const stable=freshness(before,after).fresh&&freshness(selection.provenance,before).fresh&&selection.selected.every(f=>currentDiscovery.files.includes(f))&&selection.total===currentDiscovery.files.length&&JSON.stringify(selection.decisions.map(d=>d.test).sort())===JSON.stringify([...currentDiscovery.files].sort());
        const casePreservation=compareSubsetCases(runs.full,runs.subset,runs.subset.executedFiles||selection.selected);
        const valid=casePreservation.complete&&selection.discovery?.complete!==false&&stable&&complete(runs.full)&&complete(runs.subset)&&(change.expectedFailure?fullIds.length>0:runs.full.exitCode===0)&&!missed.length&&!unexpected.length;
        const nativeValid=stable&&complete(runs.native)&&!nativeMissed.length&&!nativeUnexpected.length;
        changes.trials.push({order,valid,stable,casePreservation,mode:selection.mode,selectedFiles:selection.selected.length,totalFiles:currentDiscovery.files.length,fullCases:(runs.full.tests || []).length,subsetCases:(runs.subset.tests || []).length,fullFailures:fullIds.length,missedFailures:missed.length,unexpectedSubsetFailures:unexpected.length,fullMs:runs.full.durationMs,subsetMs:runs.subset.durationMs,planningMs,testLoreMs,verificationDiscoveryMs,netSavingMs:runs.full.durationMs-testLoreMs,nativeSelector:runs.native.selector,nativeValid,nativeFiles:(runs.native.executedFiles || []).length,nativeCases:(runs.native.tests || []).length,nativeMs:runs.native.durationMs,nativeMissedFailures:nativeMissed.length,nativeUnexpectedFailures:nativeUnexpected.length,netVsNativeMs:runs.native.durationMs-testLoreMs});
      }
    } catch (error) { changes.error = error.message; receipt.error ||= error.message; }
  }
  receipt.valid = receipt.changes.every(c => !c.error && c.trials.length === repetitions && c.trials.every(t => t.valid));
} catch (error) { receipt.error = error.message; }
finally { save('receipt', receipt); }
process.exitCode = receipt.valid ? 0 : 1;
