#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit, modules, plan, generate, run, snapshot, ingestQuality, measureStability, captureRuntime, stagePatch, validateCandidates, applyPatch, externalPlan, externalRun, aqeGenerate, improve, installQualityLayer, installQualityWorkflow, publishImprovement } from './index.js';
import { safePath, readConfig, git } from './files.js';

const help = `TDDSwarm — know why each test runs.

Usage: tddswarm <command> [options]

  improve     New branch, reviewed tests, full validation, automatic GitHub PR
  init        Create configuration and a local health report (never overwrite)
  audit       Grade static test structure; report what has not been measured
  plan        Explain which tests a Git change can affect
  run         Execute the planned tests and preserve the runner's exit code
  modules     Propose test groups and flag broad dependencies
  generate    Produce an agent work order; --execute stages reviewed candidates
  snapshot    Save source/runner/environment provenance before measurement
  evidence    Import measured coverage or mutation JSON with provenance
  stability   Measure repeated full-suite outcomes (--repeat 5)
  capture     Observe per-file runtime imports and file-read dependencies
  modularize  Stage a reviewed patch JSON (--patch file)
  validate    Validate staged candidates in disposable copies (--id id)
  apply       Review or apply a validated patch (--id id --execute)
  external-plan / external-run   Delegate to pytest-testmon, Nx, or Bazel
  aqe         Generate unreviewed candidates through an installed AQE CLI
  demo        Show a copy-only change, a shared change, and a conservative fallback

Options:
  --root <directory>  Project directory (default: current directory)
  --base <git-ref>    Compare base to working tree, including untracked files
  --changed <paths>   Comma-separated paths for a diagnostic plan (not run)
  --full             Force the full discovered test suite
  --shadow           Run the full suite while recording the proposed selection
  --execute          Invoke an agent (generate) or apply a validated patch (apply)
  --local            Keep a tested improvement branch without opening a PR
  --no-ci            Do not add a project quality workflow
  --action-ref <ref>  Pin the installed quality action to a reviewed Git ref
  --json             Machine-readable output

Supported analysis: JavaScript / TypeScript. Runtime and service dependencies
need explicit declarations. No AI account required for audit, plan, or run.
`;

export function parseArgs(args) {
  const options = {};
  let command = 'help';
  const values = new Set(['root','base','changed','output','report','type','provenance','repeat','id','patch','target','framework','head','action-ref','base-branch']);
  const flags = new Set(['json', 'full', 'shadow', 'execute', 'help', 'version', 'local', 'no-ci']);
  if (args[0] && !args[0].startsWith('-')) command = args.shift();
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (values.has(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = args[++i];
    } else if (flags.has(key) && args[i].startsWith('--')) options[key] = true;
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (options.changed) options.changed = options.changed.split(',').filter(Boolean);
  return { command, options };
}

function init(root) {
  const file = safePath(root, 'tddswarm.config.json');
  let created = false;
  if (!fs.existsSync(file)) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const runner = deps.vitest ? ['npx', '--no-install', 'vitest', 'run', '{files}'] : deps.jest ? ['npx', '--no-install', 'jest', '--runTestsByPath', '{files}'] : ['node', '--test', '{files}'];
    const adapter=deps.vitest?'vitest':deps.jest?'jest':'node';
    fs.writeFileSync(file, JSON.stringify({ runner, adapter, discovery:'native', alwaysRun: [], dependencies: {}, ignoreChanges: [], fullRunEvery: 20 }, null, 2) + '\n', { flag: 'wx' });
    created = true;
  }
  const ignore = safePath(root, '.gitignore');
  const ignoreText = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (!ignoreText.split(/\r?\n/).some(line => ['.tddswarm/', '.tddswarm', '/.tddswarm/'].includes(line.trim()))) fs.writeFileSync(ignore, ignoreText + (ignoreText && !ignoreText.endsWith('\n') ? '\n' : '') + '.tddswarm/\n');
  const report = audit(root);
  const dir = safePath(root, '.tddswarm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(report, null, 2));
  return { config: file, created, report, next: report.testFiles ? ['tddswarm plan --base HEAD', 'tddswarm run --shadow'] : ['tddswarm generate', 'Add tddswarm.requirements.md and configure an agent for generation.'] };
}
function human(command, result) {
  if (command === 'init') return `${result.created ? 'Created' : 'Kept'} ${result.config}\n${human('audit', result.report)}\nNext: ${result.next.join(' → ')}`;
  if (command === 'audit') return `${result.testFiles} test files · static triage grade ${result.grade}${result.score === null ? '' : ` (${result.score}/100)`}\n${Object.entries(result.measured).map(([key,value])=>`${key}: ${value?'measured (see JSON scope)':'not measured'}`).join(' · ')}\n${result.files.flatMap(f => f.findings.map(x => `  ${f.file}:${x.line} — ${x.message}`)).join('\n')}\n${result.sourcesWithoutImportingTests.length} source files have no importing tests (not a coverage result).`;
  if (command === 'plan') return `${result.mode.toUpperCase()} · ${result.selected.length}/${result.total} test files selected\n${result.reasons.length ? `Reasons: ${result.reasons.join(', ')}\n` : ''}${result.decisions.map(d => `${d.selected ? 'RUN ' : 'SKIP'} ${d.test} — ${d.reasons.join(', ')}${d.paths.length ? `\n     ${d.paths.map(p => p.join(' → ')).join('\n     ')}` : ''}`).join('\n')}\nStatic evidence; runtime dependencies require declarations.`;
  if (command === 'run') return `${human('plan', result.plan)}\n${result.error || (result.executed ? `Runner exited ${result.exitCode}${result.shadow ? ' (shadow: full suite)' : ''} in ${result.durationMs} ms.` : 'No tests selected.')}`;
  if(command==='improve')return `${result.status} · ${result.branch}\n${result.worktree||''}\n${result.pullRequest||result.publicationError||result.error||'Review the retained improvement receipt.'}`;
  if (command === 'modules') return `${result.groups.map(g => `${g.name}: ${g.tests.join(', ')}`).join('\n')}\nProposal only; no tests rewritten.`;
  if (command === 'generate') return result.executed ? `${result.status}: ${result.files.length} files staged in ${result.directory}\n${result.review.findings.join('\n')}\nExecution and mutation effectiveness: not measured. Review candidates before copying.` : `${result.purpose}: ${result.subjects.length} subjects\nRoles: ${result.roles.join(' → ')}\nNo agent invoked. Configure an agent and requirements, then use generate --execute.\nUse --json to export the complete work order.`;
  return JSON.stringify(result, null, 2);
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseArgs([...args]);
  if (options.version) { console.log('0.1.0'); return 0; }
  if (command === 'help' || options.help) { console.log(help); return 0; }
  const root = path.resolve(options.root || '.');
  if (command === 'run' && options.changed) throw new Error('--changed is diagnostic only. run uses Git to discover the complete change set.');
  let result;
  switch (command) {
    case 'improve': {
      let agent;
      if(!options.id&&!options.patch&&!readConfig(root).agent){
        const installed=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000,shell:false});
        if(!installed.error&&installed.status===0)agent=[process.execPath,fileURLToPath(new URL('./adapters/codex.js',import.meta.url))];
      }
      const patch=options.patch?JSON.parse(fs.readFileSync(path.resolve(root,options.patch),'utf8')):undefined;
      let defaultBranch='main';try{defaultBranch=git(root,['symbolic-ref','--short','refs/remotes/origin/HEAD']).trim().replace(/^[^/]+\//,'');}catch{}
      result=await improve(root,{...options,patch,agent,initialize:branch=>installQualityLayer(branch,{ci:false}),prepare:branch=>installQualityLayer(branch,{ci:false}),prepareRepository:(repo,{project})=>options['no-ci']?[]:installQualityWorkflow(repo,{project,actionRef:options['action-ref'],defaultBranch})});
      if(result.status==='ready-for-review'&&!options.local){
        try{result=publishImprovement(root,result,{baseBranch:options['base-branch']});}
        catch(error){result={...result,published:false,publicationError:error.message};}
      }
      if(result.receipt)fs.writeFileSync(result.receipt,JSON.stringify(result,null,2));
      break;
    }
    case 'snapshot': {
      result=snapshot(root,readConfig(root));
      const target=safePath(root,options.output||'.tddswarm/snapshot.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2));
      result={...result,output:target};break;
    }
    case 'evidence': if(!options.report)throw new Error('--report is required');result=ingestQuality(root,options.type,options.report,{provenance:options.provenance});break;
    case 'stability': result=await measureStability(root,options);break;
    case 'capture': result=await captureRuntime(root,options);break;
    case 'modularize': if(!options.patch)throw new Error('--patch is required');result=stagePatch(root,JSON.parse(fs.readFileSync(path.resolve(root,options.patch),'utf8')));break;
    case 'validate': result=validateCandidates(root,options.id,options);break;
    case 'apply': result=applyPatch(root,options.id,options);break;
    case 'external-plan': result=externalPlan(root,readConfig(root),options);break;
    case 'external-run': if(options.changed)throw new Error('--changed is diagnostic only');result=externalRun(root,readConfig(root),options);break;
    case 'aqe': result=aqeGenerate(root,options);break;
    case 'init': result = init(root); break;
    case 'audit': result = audit(root); break;
    case 'plan': result = plan(root, options); break;
    case 'run': result = run(root, { ...options, capture: options.json }); break;
    case 'modules': result = modules(root); break;
    case 'generate': result = await generate(root, options); break;
    case 'demo': {
      const demoRoot = fileURLToPath(new URL('../examples/demo', import.meta.url));
      const scenarios = [
        ['Landing-page copy', ['src/copy.json']],
        ['Shared helper', ['src/shared.js']],
        ['Unknown runtime input', ['public/unmapped.css']]
      ];
      for (const [name, changed] of scenarios) {
        const selection = plan(demoRoot, { changed });
        console.log(`\n${name}\n${human('plan', selection)}`);
      }
      console.log('\nSynthetic demonstration. No production speedup measured.');
      return 0;
    }
    default: throw new Error(`Unknown command: ${command}`);
  }
  console.log(options.json ? JSON.stringify(result, null, 2) : human(command, result));
  if(command==='improve')return result.status==='ready-for-review'&&(options.local||result.published)?0:2;
  if(['run','external-run','external-plan','aqe'].includes(command))return result.exitCode||0;
  if(command==='validate')return result.accepted?0:1;
  if(command==='capture')return result.complete?0:2;
  if(command==='stability')return !result.complete?2:result.metrics.unstable?1:0;
  return 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`TDDSwarm: ${error.message}`); process.exitCode = 2; }
}
