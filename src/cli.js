#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit, modules, plan, generate, run, snapshot, ingestQuality, measureStability, captureRuntime, stagePatch, validateCandidates, applyPatch, externalPlan, externalRun, aqeGenerate, improve, installQualityLayer, installQualityWorkflow, publishImprovement, recallLessons, reflectLearning, exportLearning, ensureQualityAgent, seedRequirements, initializeWitness, observeQuality, inspectEvidenceLoop, challengeEvidence, reviewEvidence, recallOutcomeLessons } from './index.js';
import { safePath, readConfig, git } from './files.js';
import { pluginCatalog, configurePlugin, checkPlugins, configurePluginsAutomatically } from './plugins.js';
import { recommendPlugins } from './plugin-recommendations.js';
import {measureMutation,measureTestEffectiveness} from './quality-measurement.js';
import { renderRunReport } from './run-report.js';
import { routingProposals } from './routing-proposals.js';
import { captureBrowserEvidence, proposeBrowserMappings, proposeBrowserInstrumentation, inspectBrowserBuildArtifacts } from './browser-evidence.js';
import { pilot, exportPilot } from './pilot.js';
import {verificationBrief} from './agent-contract.js';
import {qualifyRoutingMappings} from './mapping-qualification.js';
import {adoptionReadiness} from './adoption-readiness.js';

const help = `TestLore — know why each test runs.

Usage: testlore <command> [options]

  setup       Configure a quality agent, native runner and shadow CI in one command
  doctor      Inspect setup prerequisites and next actions without project execution
  brief       Give agents a bounded verification contract without running project code
  mcp         Serve project quality tools over MCP stdio (inspection only by default)
  report      Explain the last execution and every proposed omission
  mappings    Propose local runtime mappings for review (no automatic changes)
  mapping-qualify  Independently validate a proposal (--report, --changed, --execute)
  browser-capture   Collect native browser inputs using the opt-in fixture
  browser-mappings  Propose reviewed URL/source-map mappings (--report, --settings)
  browser-build Inspect explicit generated bundles/maps (--settings with artifacts)
  browser-instrument Propose an opt-in fixture patch (review only)
  agent       Create or inspect your project quality agent (--name optional)
  plugins     Choose project-fit tools with --recommend/--auto; enable, disable, select, check
  improve     New branch, reviewed tests, full validation, automatic GitHub PR
  init        Create configuration and a local health report (never overwrite)
  audit       Grade static test structure; report what has not been measured
  plan        Explain which tests a Git change can affect
  run         Execute the planned tests and preserve the runner's exit code
  modules     Propose test groups and flag broad dependencies
  generate    Produce an agent work order; --execute stages reviewed candidates
  snapshot    Save source/runner/environment provenance before measurement
  evidence    Import measured coverage or mutation JSON with provenance
  mutation    Execute installed Stryker with safe incremental reuse (--mutate paths)
  effectiveness Measure independent defects, preservation, stability and cost (--defects file)
  stability   Measure repeated full-suite outcomes (--repeat 5)
  capture     Observe per-file runtime imports and file-read dependencies
  modularize  Stage a reviewed patch JSON (--patch file)
  validate    Validate staged candidates in disposable copies (--id id)
  apply       Review or apply a validated patch (--id id --execute)
  external-plan / external-run   Delegate to pytest-testmon, Nx, or Bazel
  aqe         Generate unreviewed candidates through an installed AQE CLI
  learn       Reflect on validated local outcomes and supported lessons
  recall      Retrieve advisory historical test patterns (--query text)
  learning-export   Export aggregate metadata without source or identifiers
  pilot       Inspect local repository pilots (--manifest file); --execute runs isolated copies
  pilot-export Export fixed aggregate pilot metrics (--report local-summary.json)
  witness-init Export a recorder public key (--output path; never overwrite)
  observe     Record a signed full-suite observation (--revision label; --output checkpoint)
  loop-status Inspect signed history (--trusted-key PEM; optional --checkpoint JSON)
  challenge   Test a historical claim (--id UUID --claim claim --trusted-key PEM)
  outcome     Record an attributed review (--id --claim --verdict --reviewer --trusted-key)
  outcome-lessons Retrieve advisory reviewed outcomes (--query --trusted-key PEM)
  demo        Show a copy-only change, a shared change, and a conservative fallback

Options:
  --root <directory>  Project directory (default: current directory)
  --base <git-ref>    Compare base to working tree, including untracked files
  --changed <paths>   Comma-separated paths for a diagnostic plan (not run)
  --full             Force the full discovered test suite
  --selective        Explicitly execute only the selection (override configured shadow)
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
  const values = new Set(['root','base','changed','output','report','type','provenance','repeat','id','patch','target','framework','head','action-ref','base-branch','query','name','enable','disable','select','plugin','settings','manifest','mutate','defects','revision','deadline-ms','trusted-key','checkpoint','claim','verdict','reviewer']);
  const flags = new Set(['json', 'full', 'shadow', 'execute', 'help', 'version', 'local', 'no-ci','check','recommend','auto','selective','allow-execution']);
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

const loopOptions = {
  'witness-init': ['output'],
  observe: ['query', 'revision', 'base', 'deadline-ms', 'output'],
  'loop-status': ['trusted-key', 'checkpoint'],
  challenge: ['id', 'claim', 'trusted-key', 'checkpoint'],
  outcome: ['id', 'claim', 'verdict', 'reviewer', 'trusted-key', 'checkpoint'],
  'outcome-lessons': ['query', 'trusted-key', 'checkpoint']
};
function validateLoopOptions(command, options) {
  if (!loopOptions[command]) {
    for (const key of ['revision', 'deadline-ms', 'trusted-key', 'checkpoint', 'claim', 'verdict', 'reviewer']) if (key in options) throw new Error(`--${key} requires an evidence-loop command`);
    return;
  }
  const allowed = new Set(['root', 'json', ...loopOptions[command]]);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`--${key} does not apply to ${command}`);
  const required = {
    'witness-init': ['output'], observe: ['revision'],
    challenge: ['id', 'claim', 'trusted-key'],
    outcome: ['id', 'claim', 'verdict', 'reviewer', 'trusted-key'],
    'outcome-lessons': ['query', 'trusted-key']
  };
  for (const key of required[command] || []) if (!options[key]?.trim()) throw new Error(`--${key} is required`);
  if (options['deadline-ms'] !== undefined && (!/^\d+$/.test(options['deadline-ms']) || !Number.isSafeInteger(Number(options['deadline-ms'])) || Number(options['deadline-ms']) <= 0)) throw new Error('--deadline-ms must be a positive integer');
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
    fs.writeFileSync(file, JSON.stringify({ runner, adapter, discovery:'native', executionMode:'shadow', analysisCache:{enabled:true}, alwaysRun: [], dependencies: {}, ignoreChanges: [], fullRunEvery: 20 }, null, 2) + '\n', { flag: 'wx' });
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
  if (command === 'doctor') return `${result.state}\n${result.checks.map(row => `${row.id}: ${row.status} — ${row.reason}`).join('\n')}\nNext: ${result.nextAction}\nStatic prerequisites only; native execution and routing remain unqualified.`;
  if ((command === 'plan' || command === 'run') && (result.delegated || result.targets !== undefined || result.plan?.targets !== undefined)) {
    const selection = result.plan || result;
    return `${result.adapter || selection.adapter} · ${selection.mode || 'native'} · ${Array.isArray(selection.targets) ? selection.targets.length + ' native targets' : 'selection delegated to native execution'}\n${result.error || (command === 'run' ? `Runner exited ${result.exitCode}; evidence ${result.complete ? 'complete' : 'incomplete'}.` : selection.reasons?.join(', ') || 'Native graph discovery.')}\nNative scope is preserved; no individual-case comparison is implied.`;
  }
  if (command === 'plugins' && result.recommendations) return result.recommendations.map(choice => `${choice.id} · ${choice.status} · ${choice.reasons.join('; ')}`).join('\n') + (result.applied ? `\nEnabled: ${result.applied.join(', ') || 'none; explicit choices retained or prerequisites missing'}` : '\nInspect only. Use plugins --auto to enable compatible installed tools.');
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
  if (options.version) { console.log(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version); return 0; }
  if (command === 'help' || options.help) { console.log(help); return 0; }
  validateLoopOptions(command, options);
  const root = path.resolve(options.root || '.');
  if (command === 'mcp') {
    if (Object.keys(options).some(key => !['root','allow-execution'].includes(key))) throw new Error('mcp accepts only --root and --allow-execution');
    const {startMcpServer} = await import('./mcp.js');
    await startMcpServer({root, allowExecution: options['allow-execution'] === true});
    return 0;
  }
  if (options['allow-execution']) throw new Error('--allow-execution applies only to mcp');
  if ((options.auto || options.recommend) && command !== 'plugins') throw new Error('--auto and --recommend require the plugins command');
  if(options.shadow && options.selective)throw new Error('Choose --shadow or --selective');
  if (command === 'run' && options.changed) throw new Error('--changed is diagnostic only. run uses Git to discover the complete change set.');
  let result;
  switch (command) {
    case 'witness-init': result = initializeWitness(root, {output: path.resolve(root, options.output)}); break;
    case 'observe': {
      const output = options.output ? path.resolve(root, options.output) : undefined;
      if (output && fs.existsSync(output)) throw new Error(`Checkpoint output already exists: ${output}`);
      if (output && !fs.statSync(path.dirname(output)).isDirectory()) throw new Error('Checkpoint output parent must be an existing directory');
      result = observeQuality(root, {revision: options.revision, focus: options.query, base: options.base, deadlineMs: options['deadline-ms'] === undefined ? undefined : Number(options['deadline-ms'])});
      if (output) {
        fs.writeFileSync(output, JSON.stringify(result.checkpoint, null, 2) + '\n', {flag: 'wx'});
        result = {...result, output};
      }
      break;
    }
    case 'loop-status': result = inspectEvidenceLoop(root, {trustedKey: options['trusted-key'] && path.resolve(root, options['trusted-key']), checkpoint: options.checkpoint && path.resolve(root, options.checkpoint)}); break;
    case 'challenge': result = challengeEvidence(root, {id: options.id, claim: options.claim, trustedKey: path.resolve(root, options['trusted-key']), checkpoint: options.checkpoint && path.resolve(root, options.checkpoint)}); break;
    case 'outcome': result = reviewEvidence(root, {id: options.id, claim: options.claim, verdict: options.verdict, reviewer: options.reviewer, trustedKey: path.resolve(root, options['trusted-key']), checkpoint: options.checkpoint && path.resolve(root, options.checkpoint)}); break;
    case 'outcome-lessons': result = recallOutcomeLessons(root, {query: options.query, trustedKey: path.resolve(root, options['trusted-key']), checkpoint: options.checkpoint && path.resolve(root, options.checkpoint)}); break;
    case 'brief': result = verificationBrief(root, {task: options.query || '', changed: options.changed || []}); break;
    case 'doctor': {
      if(Object.keys(options).some(key=>!['root','json'].includes(key)))throw new Error('doctor accepts only --root and --json; it never invokes project commands');
      result=adoptionReadiness(root);break;
    }
    case 'setup': {
      const written=installQualityLayer(root,{ci:!options['no-ci'],actionRef:options['action-ref']});
      const agent=ensureQualityAgent(root,{name:options.name});
      result={written,agent,executionMode:readConfig(root).executionMode||'existing-policy',readiness:adoptionReadiness(root),plugins:recommendPlugins(root),next:['testlore doctor --json','testlore run --shadow --base HEAD --json','testlore report','testlore mappings --json']};break;
    }
    case 'report': result=JSON.parse(fs.readFileSync(safePath(root,options.report||'.tddswarm/last-run.json'),'utf8'));if(!options.json){console.log(renderRunReport(result));return result.exitCode||0;}break;
    case 'mappings': result=routingProposals(root);break;
    case 'mapping-qualify': {
      if(Object.keys(options).some(key=>!['root','report','changed','execute','json'].includes(key)))throw new Error('mapping-qualify accepts only --root, --report, --changed, --execute and --json');
      if(!options.execute||!options.report||!options.changed?.length)throw new Error('mapping-qualify requires --report, --changed and --execute; native project code runs in disposable source copies');
      const file=safePath(root,options.report);if(fs.statSync(file).size>2*1024*1024)throw new Error('Mapping proposal exceeds 2 MiB');
      result=qualifyRoutingMappings(root,JSON.parse(fs.readFileSync(file,'utf8')),{changed:options.changed});break;
    }
    case 'browser-build': {if(!options.settings)throw new Error('--settings JSON with explicit artifacts is required');result=inspectBrowserBuildArtifacts(root,JSON.parse(fs.readFileSync(safePath(root,options.settings),'utf8')));break;}
    case 'browser-instrument': result=await proposeBrowserInstrumentation(root);break;
    case 'browser-capture': result=await captureBrowserEvidence(root,options);break;
    case 'browser-mappings': {if(!options.report||!options.settings)throw new Error('--report and --settings are required');result=proposeBrowserMappings(root,JSON.parse(fs.readFileSync(safePath(root,options.report),'utf8')),JSON.parse(fs.readFileSync(safePath(root,options.settings),'utf8')));break;}
    case 'pilot': if(!options.manifest)throw new Error('--manifest is required');result=pilot(root,JSON.parse(fs.readFileSync(path.resolve(root,options.manifest),'utf8')),options);break;
    case 'pilot-export': if(!options.report)throw new Error('--report is required');result=exportPilot(JSON.parse(fs.readFileSync(path.resolve(root,options.report),'utf8')));break;
    case 'plugins': {
      const mutations = [options.enable, options.disable, options.select].filter(Boolean);
      if (mutations.length + [options.check,options.recommend,options.auto].filter(Boolean).length > 1) throw new Error('Choose one plugin enable, disable, select, check, recommend, or auto operation');
      if (options.settings && !options.enable && !options.select) throw new Error('--settings requires --enable or --select');
      if (options.recommend || options.auto) {
        const recommendation = recommendPlugins(root);
        if (options.auto) {
          if (recommendPlugins(root).fingerprint !== recommendation.fingerprint) throw new Error('Project evidence changed during inspection; retry');
          result = configurePluginsAutomatically(root, recommendation);
        } else result = recommendation;
      } else if (mutations.length) {
        const settings = options.settings ? JSON.parse(fs.readFileSync(safePath(root, options.settings), 'utf8')) : undefined;
        result = configurePlugin(root, mutations[0], {enabled: Boolean(options.enable || options.select), settings, select:Boolean(options.select)});
      } else result = options.check ? checkPlugins(root, {id:options.plugin}) : pluginCatalog(root);
      break;
    }
    case 'improve': {
      let agent;
      if(!options.id&&!options.patch&&!readConfig(root).agent){
        const installed=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000,shell:false});
        if(!installed.error&&installed.status===0)agent=[process.execPath,fileURLToPath(new URL('./adapters/codex.js',import.meta.url))];
      }
      const patch=options.patch?JSON.parse(fs.readFileSync(path.resolve(root,options.patch),'utf8')):undefined;
      let defaultBranch='main';try{defaultBranch=git(root,['symbolic-ref','--short','refs/remotes/origin/HEAD']).trim().replace(/^[^/]+\//,'');}catch{}
      const projectAgent=ensureQualityAgent(root);
      result=await improve(root,{...options,patch,agent,initialize:branch=>[...installQualityLayer(branch,{ci:false}),...seedRequirements(branch)],prepare:branch=>installQualityLayer(branch,{ci:false}),prepareRepository:(repo,{project})=>options['no-ci']?[]:installQualityWorkflow(repo,{project,actionRef:options['action-ref'],defaultBranch})});
      result.agentProfile=projectAgent.profile;
      if(result.status==='ready-for-review'&&!options.local){
        try{result=publishImprovement(root,result,{baseBranch:options['base-branch']});}
        catch(error){result={...result,published:false,publicationError:error.message};}
      }
      if(result.receipt)fs.writeFileSync(result.receipt,JSON.stringify(result,null,2));
      break;
    }
    case 'agent': result=ensureQualityAgent(root,{name:options.name});break;
    case 'learn': result=reflectLearning(root);break;
    case 'recall': if(!options.query)throw new Error('--query is required');result=recallLessons(root,options.query);break;
    case 'learning-export': result=exportLearning(root);break;
    case 'snapshot': {
      result=snapshot(root,readConfig(root));
      const target=safePath(root,options.output||'.tddswarm/snapshot.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2));
      result={...result,output:target};break;
    }
    case 'evidence': if(!options.report)throw new Error('--report is required');result=ingestQuality(root,options.type,options.report,{provenance:options.provenance});break;
    case 'mutation': {
      if(!options.mutate)throw new Error('--mutate comma-separated source paths is required');
      const settings=options.settings?JSON.parse(fs.readFileSync(safePath(root,options.settings),'utf8')):{};
      result=await measureMutation(root,{...settings,mutate:options.mutate.split(',').filter(Boolean)});
      if(result.complete)result.qualityEvidence=ingestQuality(root,'mutation',result.rawPath,{provenance:result.provenance,scope:result.scope});
      break;
    }
    case 'effectiveness': {
      if(!options.defects)throw new Error('--defects independently authored JSON is required');
      const defects=JSON.parse(fs.readFileSync(safePath(root,options.defects),'utf8'));
      const candidateFiles=options.patch?JSON.parse(fs.readFileSync(safePath(root,options.patch),'utf8')).files:undefined;
      result=measureTestEffectiveness(root,{defects,candidateFiles,repetitions:options.repeat===undefined?3:Number(options.repeat)});break;
    }
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
  if(command==='observe')return result.exitCode ?? 2;
  if(command==='loop-status')return result.valid && result.complete ? 0 : 2;
  if(command==='challenge')return result.supported ? 0 : 1;
  if(command==='improve')return result.status==='ready-for-review'&&(options.local||result.published)?0:2;
  if(command==='plugins' && options.check)return result.exitCode || 0;
  if(command==='doctor')return result.blocked.length?1:0;
  if(command==='pilot' && result.executed)return result.valid?0:1;
  if(['plan','run','external-run','external-plan','aqe'].includes(command))return result.exitCode||0;
  if(command==='validate')return result.accepted?0:1;
  if(command==='mutation')return result.complete?0:2;
  if(command==='effectiveness')return !result.complete?2:result.dimensions.defectDetection.demonstrated>result.dimensions.defectDetection.caught?1:0;
  if(command==='browser-capture')return result.complete?0:2;
  if(command==='mapping-qualify')return !result.complete?2:result.qualified?0:1;
  if(command==='capture')return result.complete?0:2;
  if(command==='stability')return !result.complete?2:result.metrics.unstable?1:0;
  return 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`TestLore: ${error.message}`); process.exitCode = 2; }
}
