#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Load only the implementation graph of the requested command. Executable project
// configuration remains inside each fresh invocation's existing planning/runner path.
const commandModules = {
  'witness-init': ['evidence-loop'], observe: ['evidence-loop'],
  'loop-status': ['evidence-loop'], challenge: ['evidence-loop'],
  outcome: ['evidence-loop'], 'outcome-lessons': ['evidence-loop'],
  brief: ['agent-contract'], doctor: ['adoption-readiness'],
  setup: ['quality-layer', 'agent-profile', 'files', 'adoption-readiness', 'plugin-recommendations', 'plugins', 'run-report'],
  report: ['files', 'run-report'], mappings: ['routing-proposals'],
  'mapping-qualify': ['files', 'mapping-qualification'],
  'browser-build': ['files', 'browser-evidence'], 'browser-instrument': ['browser-evidence'],
  'browser-capture': ['browser-evidence'], 'browser-mappings': ['files', 'browser-evidence'],
  pilot: ['pilot'], 'pilot-export': ['pilot'],
  plugins: ['files', 'plugins', 'plugin-recommendations'],
  assess: ['assessments'], campaign: ['community-campaign'],
  improve: ['files', 'agent-profile', 'improvement', 'quality-layer', 'pull-request'],
  repair: ['files', 'repair', 'pull-request'],
  autopilot: ['files', 'repair', 'improvement', 'pull-request'],
  agent: ['agent-profile'], learn: ['learning'], recall: ['learning'], 'learning-export': ['learning'],
  'knowledge-import': ['contribution-knowledge'], knowledge: ['contribution-knowledge', 'files'],
  'knowledge-reflect': ['contribution-knowledge'],
  'probe-qualify': ['bug-recipes','bug-investigation','files'],
  investigate: ['bug-investigation'], immunity: ['bug-investigation'],
  'investigation-outcome': ['investigation-outcomes'], 'investigation-links': ['investigation-outcomes'],
  'investigation-learn': ['investigation-outcomes'],
  'investigation-repair': ['investigation-repair','files','pull-request'],
  'probe-catalog': ['bug-catalog'],
  snapshot: ['files', 'provenance'], evidence: ['evidence'],
  mutation: ['files', 'quality-measurement', 'evidence'], effectiveness: ['files', 'quality-measurement'],
  stability: ['evidence'], capture: ['evidence'], modularize: ['candidates'],
  validate: ['candidates'], apply: ['candidates'],
  'external-plan': ['files', 'integrations'], 'external-run': ['files', 'integrations'],
  aqe: ['adapters/aqe'], init: ['files', 'audit', 'quality-layer'],
  audit: ['audit'], plan: ['selector'], run: ['runner', 'run-report'], modules: ['audit'],
  generate: ['swarm'], demo: ['selector']
};
async function loadCommand(command) {
  if (!Object.hasOwn(commandModules, command)) throw new Error(`Unknown command: ${command}`);
  return Object.assign({}, ...await Promise.all(commandModules[command].map(module => import(`./${module}.js`))));
}

const help = `TestLore — know why each test runs.

Usage: testlore <command> [options]

  setup       Configure a quality agent and shadow CI; --verify records a full shadow run
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
  campaign    Replay bounded community contribution captures (--manifest local.json)
  assess      Import advisory Guardana/iFixAi reports (--plugin name --report local.json)
  improve     New branch, reviewed tests, full validation, automatic GitHub PR
  repair      Bounded source repair of repeated Node assertion failures, automatic PR
  autopilot   Discover failures or test gaps; delegate, validate, and open a review PR
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
  knowledge-import Import a hash-bound public PR snapshot (--report, --sha256)
  knowledge   Retrieve advisory contribution hypotheses (--query, --contract local.md)
  knowledge-reflect Inspect public contribution outcomes and pattern hypotheses
  probe-qualify Replay a declared historical fault/fix (--manifest local.json --execute)
  probe-catalog Inspect bundled historical recipes; --execute copies them for review
  investigate Plan historical bug probes; --execute runs approved module hypotheses
  immunity    Inspect repository observation, unresolved probes and advisory learning
  investigation-outcome Record a reviewed finding (--report --sha256 --id --verdict --reviewer)
  investigation-links Propose source/test associations (--report --sha256), no omissions
  investigation-learn Inspect useful findings, false positives, duplicates and costs
  investigation-repair Verify a new regression, delegate repair and open a reviewed PR
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
  --unified-native   Opt in to one fresh Vitest planning/execution context (prototype)
  --shadow           Run the full suite while recording the proposed selection
  --execute          Invoke an agent (generate) or apply a validated patch (apply)
  --local            Keep a tested improvement branch without opening a PR
  --sources <paths>  Comma-separated existing production source scope for repair
  --provider <name>  Generation author choice: auto (default), json-worker, agentic-qe
  --autofix          setup: add an opt-in trusted self-hosted agent workflow
  --immunity         setup: add reviewed probes to trusted change-driven investigation
  --no-ci            Do not add a project quality workflow
  --action-ref <ref>  Pin the installed quality action to a reviewed Git ref
  --json             Machine-readable output

Supported analysis: JavaScript / TypeScript. Runtime and service dependencies
need explicit declarations. No AI account required for audit, plan, or run.
`;

export function parseArgs(args) {
  const options = {};
  let command = 'help';
  const values = new Set(['root','base','changed','output','report','type','provenance','repeat','id','patch','target','framework','head','action-ref','base-branch','query','name','enable','disable','select','plugin','settings','manifest','mutate','defects','revision','deadline-ms','trusted-key','checkpoint','claim','verdict','reviewer','sources','provider','sha256','contract','exclude-repositories']);
  const flags = new Set(['json', 'full', 'shadow', 'execute', 'help', 'version', 'local', 'no-ci','check','recommend','auto','selective','allow-execution','unified-native','verify','autofix','immunity']);
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
  if(['investigation-outcome','investigation-repair'].includes(command))return;
  if (!Object.hasOwn(loopOptions, command)) {
    if(['repair','autopilot'].includes(command)){
      if(options['deadline-ms']!==undefined&&(!/^\d+$/.test(options['deadline-ms'])||Number(options['deadline-ms'])<1||Number(options['deadline-ms'])>900000))throw new Error('--deadline-ms must be 1–900000');
      for(const key of ['revision','trusted-key','checkpoint','claim','verdict','reviewer'])if(key in options)throw new Error(`--${key} requires an evidence-loop command`);
      return;
    }
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

function init(root, {safePath, defaultNativeAdapter, defaultNativeRunner, audit}) {
  const file = safePath(root, 'tddswarm.config.json');
  let created = false;
  if (!fs.existsSync(file)) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
    const adapter=defaultNativeAdapter(pkg);
    const runner = defaultNativeRunner(root,adapter);
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
function human(command, result, implementations = {}) {
  if(command==='mappings') {
    const diagnostics=result.processRegistrations,rows=diagnostics?.proposals||[];
    const lines=rows.slice(0,8).map(row=>`${row.fixture}\n  Launch candidates: ${row.launches.map(launch=>launch.source).join(', ')||'unresolved'}\n  Test candidates: ${row.discoveredConsumerCandidates?.length||0} discovered; ${row.excludedConsumerCandidates?.length||0} outside native inventory\n  Next: ${row.nextAction}`);
    return `${result.proposals.length} dependency mapping suggestions; review required.\nProcess registration diagnostics: ${result.processRegistrationDiagnostic?'unavailable; review launch inputs manually':`${rows.length} source-bound candidates`}\n${lines.join('\n')}\nNo omissions authorized; all existing uncertainty remains active. Use --json for source bindings and unresolved inputs.`;
  }
  if(command==='knowledge-import')return result.imported?`Imported ${result.records} public upstream contribution records. Inventory coverage: ${result.coverage.complete?'complete for captured scope':'incomplete'}\nLocal advisory index: ${result.path}\n${result.patterns.length} pattern hypotheses; defect-fix verification and learning improvement remain unproven.`:`Import declined: ${result.reason}`;
  if(command==='knowledge')return `${result.records.length} relevant public contribution references; advisory only.\n${result.records.map(row=>`${row.url} · ${row.outcome} · contract anchors: ${row.contractMatches.join(', ')}`).join('\n')}\n${result.patterns?.map(row=>`${row.id}: ${row.nextCheck}`).join('\n')||result.reason||''}\nOriginal requirements, unchanged tests and independent review determine acceptance.`;
  if(command==='knowledge-reflect')return result.reason?`Knowledge unavailable: ${result.reason}`:`${result.coverage.retainedCount} public upstream contribution records; ${result.outcomes.merged} merged, ${result.outcomes.open} open, ${result.outcomes.draft} drafts, ${result.outcomes.closed} closed without merge.\n${result.patterns.map(row=>`${row.id}: ${row.records} records across ${row.distinctRepositories} repositories (${row.outcomes.merged} merged). ${row.nextCheck}`).join('\n')}\nPattern correlations are hypotheses. Verified defect fixes: unknown. Learning improvement: unproven.`;
  if(command==='setup'&&result.verification)return `${implementations.renderFirstRunSummary(result.verification)}\n${result.verification.executed===true&&!result.verification.delegated?'Receipts: .tddswarm/last-run.md and .tddswarm/last-run.json':'No new per-case receipt is confirmed; inspect the native result and rerun full verification.'}\nSetup files: ${result.written.join(', ')||'existing configuration preserved'}\nUse testlore report for the full decisions and uncertainty.`;
  if(command==='setup')return `TestLore setup: ${result.readiness.state}\n${result.written.length} setup files written; execution mode ${result.executionMode}.\nNo tests executed.\nNext: ${result.readiness.nextAction}\nUse testlore setup --verify to collect full shadow evidence.`;
  if(command==='run')return `${implementations.renderFirstRunSummary(result)}\n${result.executed===true&&!result.delegated?'Receipts: .tddswarm/last-run.md and .tddswarm/last-run.json':'No new per-case receipt is confirmed; inspect the native result and rerun full verification.'}\nUse testlore report for the full decisions and uncertainty.`;
  if (command === 'campaign') return `${result.summary.retainedAttempts} retained attempts; ${result.summary.qualifiedRegressions} scoped regressions, ${result.summary.qualifiedRouting} routing comparisons, ${result.summary.measuredSpeedAdvantages} measured speed advantages.\n${result.attempts.map(item => `${item.id}: ${item.status} — ${item.reasons.join('; ') || 'review captured scope and provenance'}`).join('\n')}\nSubmitted: ${result.summary.submitted}; captured accepted: ${result.summary.accepted}. Historical captures; source independence and current GitHub status need review.`;
  if (command === 'assess') return result.assessments.map(item => `${item.plugin} · ${item.outcome} · historical report (current binding unverified)\n${item.nextAction}`).join('\n') + `\n${result.nextAction}\nReceipt: ${result.receipt}`;
  if (command === 'doctor') return `${result.state}\n${result.checks.map(row => `${row.id}: ${row.status} — ${row.reason}`).join('\n')}\nNext: ${result.nextAction}\nStatic prerequisites only; native execution and routing remain unqualified.`;
  if ((command === 'plan' || command === 'run') && (result.delegated || result.targets !== undefined || result.plan?.targets !== undefined)) {
    const selection = result.plan || result;
    return `${result.adapter || selection.adapter} · ${selection.mode || 'native'} · ${Array.isArray(selection.targets) ? selection.targets.length + ' native targets' : 'selection delegated to native execution'}\n${result.error || (command === 'run' ? `Runner exited ${result.exitCode}; evidence ${result.complete ? 'complete' : 'incomplete'}.` : selection.reasons?.join(', ') || 'Native graph discovery.')}\nNative scope is preserved; no individual-case comparison is implied.`;
  }
  if (command === 'plugins' && result.recommendations) return result.recommendations.map(choice => `${choice.id} · ${choice.status} · ${choice.reasons.join('; ')}`).join('\n') + (result.applied ? `\nEnabled: ${result.applied.join(', ') || 'none; explicit choices retained or prerequisites missing'}` : '\nInspect only. Use plugins --auto to enable compatible installed tools.');
  if (command === 'init') return `${result.created ? 'Created' : 'Kept'} ${result.config}\n${human('audit', result.report)}\nNext: ${result.next.join(' → ')}`;
  if (command === 'audit') return `${result.testFiles} test files · static triage grade ${result.grade}${result.score === null ? '' : ` (${result.score}/100)`}\n${Object.entries(result.measured).map(([key,value])=>`${key}: ${value?'measured (see JSON scope)':'not measured'}`).join(' · ')}\n${result.files.flatMap(f => f.findings.map(x => `  ${f.file}:${x.line} — ${x.message}`)).join('\n')}\n${result.sourcesWithoutImportingTests.length} source files have no importing tests (not a coverage result).`;
  if (command === 'plan') return `${result.mode.toUpperCase()} · ${result.selected.length}/${result.total} test files selected\n${result.reasons.length ? `Reasons: ${result.reasons.join(', ')}\n` : ''}${result.decisions.map(d => `${d.selected ? 'RUN ' : 'SKIP'} ${d.test} — ${d.reasons.join(', ')}${d.paths.length ? `\n     ${d.paths.map(p => p.join(' → ')).join('\n     ')}` : ''}`).join('\n')}\nStatic evidence; runtime dependencies require declarations.`;
  if(['improve','repair','autopilot','investigation-repair'].includes(command))return `${result.status} · ${result.branch||result.kind||command}\n${result.worktree||''}\n${result.pullRequest||result.publicationError||result.error||result.next?.join('\n')||'Review the retained improvement receipt.'}`;
  if(command==='probe-catalog')return `${result.entries.length} qualified historical recipes · ${result.directory||'read-only catalog'}\n${result.entries.map(row=>`${row.id} — ${row.contract}`).join('\n')}\n${result.nextAction}`;
  if(command==='investigate'||command==='immunity')return `${result.kind} · ${result.status||'observation'}\n${result.summary?Object.entries(result.summary).map(([key,value])=>`${key}: ${value}`).join(' · '):result.coverage?`${result.coverage.approvedInvestigations} approved probes · ${result.coverage.unresolvedInvestigations} unresolved`:result.candidates?`${result.candidates.filter(row=>row.applicable).length}/${result.candidates.length} approved probes`:'No reviewed probe scope yet.'}\n${result.receipt||''}\n${result.nextAction}\nNo universal coverage or automatic learning improvement is established.`;
  if (command === 'modules') return `${result.groups.map(g => `${g.name}: ${g.tests.join(', ')}`).join('\n')}\nProposal only; no tests rewritten.`;
  if (command === 'generate') return result.executed ? `${result.status}: ${result.files.length} files staged in ${result.directory}\n${result.review.findings.join('\n')}\nExecution and mutation effectiveness: not measured. Review candidates before copying.` : `${result.purpose}: ${result.subjects.length} subjects\nRoles: ${result.roles.join(' → ')}\nNo agent invoked. Configure an agent and requirements, then use generate --execute.\nUse --json to export the complete work order.`;
  return JSON.stringify(result, null, 2);
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseArgs([...args]);
  if (options.version) { console.log(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version); return 0; }
  if (command === 'help' || options.help) { console.log(help); return 0; }
  validateLoopOptions(command, options);
  const investigationOptions={'probe-catalog':['output','execute'],'probe-qualify':['manifest','execute'],investigate:['manifest','execute'],immunity:['manifest','execute'],'investigation-outcome':['report','sha256','id','verdict','reviewer'],'investigation-links':['report','sha256'],'investigation-learn':[],'investigation-repair':['report','sha256','id','local','patch','deadline-ms','base-branch']};
  if(Object.hasOwn(investigationOptions,command)){
    const allowed=new Set(['root','json',...investigationOptions[command]]);
    for(const key of Object.keys(options))if(!allowed.has(key))throw new Error(`--${key} does not apply to ${command}`);
    const required={'probe-qualify':['manifest','execute'],'investigation-outcome':['report','sha256','id','verdict','reviewer'],'investigation-links':['report','sha256'],'investigation-repair':['report','sha256','id']}[command]||[];
    for(const key of required)if(!options[key])throw new Error(`--${key} is required`);
  }
  const knowledgeOptions={'knowledge-import':['report','sha256'],knowledge:['query','contract','exclude-repositories'],'knowledge-reflect':[]};
  if(Object.hasOwn(knowledgeOptions,command)){
    const allowed=new Set(['root','json',...knowledgeOptions[command]]);
    for(const key of Object.keys(options))if(!allowed.has(key))throw new Error(`--${key} does not apply to ${command}`);
    for(const key of command==='knowledge-import'?['report','sha256']:command==='knowledge'?['query','contract']:[])if(!options[key]?.trim())throw new Error(`--${key} is required`);
  }else for(const key of ['sha256','contract','exclude-repositories'])if(key in options&&!Object.hasOwn(investigationOptions,command))throw new Error(`--${key} requires a knowledge command`);
  const root = path.resolve(options.root || '.');
  if (command === 'mcp') {
    if (Object.keys(options).some(key => !['root','allow-execution'].includes(key))) throw new Error('mcp accepts only --root and --allow-execution');
    const {startMcpServer} = await import('./mcp.js');
    await startMcpServer({root, allowExecution: options['allow-execution'] === true});
    return 0;
  }
  if (options['unified-native'] && !['run','pilot'].includes(command)) throw new Error('--unified-native applies only to run or pilot');
  if(options.verify&&command!=='setup')throw new Error('--verify applies only to setup');
  if(options.autofix&&command!=='setup')throw new Error('--autofix applies only to setup');
  if(options.immunity&&command!=='setup')throw new Error('--immunity applies only to setup');
  if(options.sources&&!['repair','autopilot'].includes(command))throw new Error('--sources applies only to repair or autopilot');
  if(options.provider!==undefined){if(!['generate','improve','autopilot'].includes(command))throw new Error('--provider applies only to generation, improvement or autopilot');if(!['auto','json-worker','agentic-qe'].includes(options.provider))throw new Error('--provider must be auto, json-worker or agentic-qe');if(options.plugin)throw new Error('Choose --provider or --plugin, not both');}
  if(options.verify&&options.selective)throw new Error('setup --verify always uses full shadow verification');
  if (options['allow-execution']) throw new Error('--allow-execution applies only to mcp');
  if ((options.auto || options.recommend) && command !== 'plugins') throw new Error('--auto and --recommend require the plugins command');
  if(options.shadow && options.selective)throw new Error('Choose --shadow or --selective');
  if (command === 'run' && options.changed) throw new Error('--changed is diagnostic only. run uses Git to discover the complete change set.');
  const implementations = await loadCommand(command);
  const {audit, modules, plan, generate, run, runUnifiedNative, snapshot, ingestQuality,
    measureStability, captureRuntime, stagePatch, validateCandidates, applyPatch,
    externalPlan, externalRun, aqeGenerate, improve, repair, installQualityLayer, installQualityWorkflow, installAutofixWorkflow, assertAutofixPrerequisites,
    publishImprovement, recallLessons, reflectLearning, exportLearning, ensureQualityAgent,
    seedRequirements, initializeWitness, observeQuality, inspectEvidenceLoop, challengeEvidence,
    reviewEvidence, recallOutcomeLessons, safePath, readConfig, git, pluginCatalog, configurePlugin,
    checkPlugins, configurePluginsAutomatically, recommendPlugins, measureMutation,
    measureTestEffectiveness, renderRunReport, routingProposals, captureBrowserEvidence,
    proposeBrowserMappings, proposeBrowserInstrumentation, inspectBrowserBuildArtifacts,
    pilot, exportPilot, verificationBrief, qualifyRoutingMappings, adoptionReadiness, importAssessments, assessCommunityCampaignFile} = implementations;
  let result;
  switch (command) {
    case 'probe-catalog': result=options.execute?implementations.installBundledBugRecipes(root,{directory:options.output}):implementations.listBundledBugRecipes();break;
    case 'probe-qualify': {
      const profile=implementations.readInvestigationInput(root,options.manifest).value;
      if(!profile||Object.keys(profile).some(key=>!['recipe','original','fixed','output'].includes(key))||!profile.recipe||Object.keys(profile.recipe).some(key=>!['path','sha256'].includes(key))||!/[a-f0-9]{64}/.test(profile.recipe.sha256)||profile.recipe.sha256.length!==64||!profile.output)throw new Error('Invalid recipe replay profile');
      const loaded=implementations.readBugRecipe(root,profile.recipe.path,profile.recipe.sha256);
      const scope=value=>{if(!value||Object.keys(value).some(key=>!['root','module','files'].includes(key))||typeof value.root!=='string')throw new Error('Invalid recipe replay source scope');return {...value,root:value.root==='.'?root:implementations.safePath(root,value.root)};};
      result=await implementations.qualifyBugRecipe({recipe:loaded.recipe,original:scope(profile.original),fixed:scope(profile.fixed),outputRoot:implementations.safePath(root,profile.output)});break;
    }
    case 'investigate': result=await implementations.investigateBugs(root,{manifest:options.manifest,execute:options.execute===true});break;
    case 'immunity': result=await implementations.immunityStatus(root,{manifest:options.manifest,execute:options.execute===true});break;
    case 'investigation-outcome': result=implementations.recordInvestigationOutcome(root,{report:options.report,reportSha256:options.sha256,findingId:options.id,verdict:options.verdict,reviewer:options.reviewer});break;
    case 'investigation-links': result=implementations.investigationDependencyLinks(root,options.report,{expectedSha256:options.sha256});break;
    case 'investigation-learn': result=implementations.inspectInvestigationLearning(root);break;
    case 'investigation-repair': {
      const {spawnSync}=await import('node:child_process');let agent=implementations.readConfig(root).agent;
      if(!agent&&!options.patch){const probe=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000,shell:false});if(!probe.error&&probe.status===0)agent=[process.execPath,fileURLToPath(new URL('./adapters/codex.js',import.meta.url))];}
      let patch;if(options.patch){const {readInvestigationInput}=await import('./bug-investigation.js');patch=readInvestigationInput(root,options.patch,{maxBytes:131072}).value;}
      result=await implementations.repairInvestigation(root,{report:options.report,reportSha256:options.sha256,findingId:options.id,agent,patch,deadlineMs:options['deadline-ms']===undefined?undefined:Number(options['deadline-ms'])});
      if(result.status==='ready-for-review'&&!options.local){try{result=implementations.publishImprovement(root,result,{baseBranch:options['base-branch']});}catch(error){result={...result,published:false,publicationError:error.message};}}
      if(result.receipt)fs.writeFileSync(result.receipt,JSON.stringify(result,null,2));break;
    }
    case 'knowledge-import': result=implementations.importContributionKnowledge(root,options.report,{expectedSha256:options.sha256});break;
    case 'knowledge-reflect': result=implementations.reflectContributionKnowledge(root);break;
    case 'knowledge': {
      const file=safePath(root,options.contract);
      const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
      let contract;
      try{
        const stat=fs.fstatSync(fd);
        if(!stat.isFile()||stat.size>16000)throw new Error('Contract must be a regular file of at most 16000 UTF-8 bytes');
        const bytes=Buffer.alloc(stat.size+1);let length=0;
        for(let count;length<bytes.length&&(count=fs.readSync(fd,bytes,length,bytes.length-length,null));)length+=count;
        const after=fs.fstatSync(fd),named=fs.lstatSync(safePath(root,options.contract));
        if(length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||named.isSymbolicLink()||named.dev!==stat.dev||named.ino!==stat.ino)throw new Error('Contract changed during bounded admission');
        contract=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
      }finally{fs.closeSync(fd);}
      result=implementations.recallContributionKnowledge(root,options.query,{contract,excludeRepositories:options['exclude-repositories']?.split(',')||[]});break;
    }
    case 'assess': {
      if (Object.keys(options).some(key => !['root','json','plugin','report','output'].includes(key))) throw new Error('assess accepts only --root, --json, --plugin, --report and --output; it never executes providers');
      result = importAssessments(root, { plugin: options.plugin, report: options.report, output: options.output }); break;
    }
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
      if((options.autofix||options.immunity)&&options['no-ci'])throw new Error('setup --autofix or --immunity requires CI');
      // Validate agent prerequisites before mutating setup files.
      if(options.autofix)assertAutofixPrerequisites(root,readConfig(root),{actionRef:options['action-ref']});
      const written=installQualityLayer(root,{ci:!options['no-ci'],actionRef:options['action-ref']});
      if(options.autofix)written.push(...installAutofixWorkflow(root,{actionRef:options['action-ref']}));
      const agent=ensureQualityAgent(root,{name:options.name});
      const recommendation=recommendPlugins(root);
      const plugins=recommendation.blocked?{...recommendation,applied:[],changed:false}:configurePluginsAutomatically(root,recommendation);
      if(plugins.changed&&!written.includes('tddswarm.config.json'))written.push('tddswarm.config.json');
      result={written,agent,executionMode:readConfig(root).executionMode||'existing-policy',readiness:adoptionReadiness(root),plugins,next:['testlore doctor --json','testlore run --shadow --base HEAD --json','testlore report','testlore mappings --json']};
      if(options.immunity){const {installInvestigationWorkflow}=await import('./bug-investigation.js');result.written.push(...installInvestigationWorkflow(root,{actionRef:options['action-ref'],manifest:options.manifest}));const config=readConfig(root);config.investigation={enabled:true,manifest:options.manifest||'tddswarm.probes.json'};fs.writeFileSync(safePath(root,'tddswarm.config.json'),JSON.stringify(config,null,2)+'\n');if(!result.written.includes('tddswarm.config.json'))result.written.push('tddswarm.config.json');}
      if(options.verify){
        const {run:verify}=await import('./runner.js');
        result.verification=verify(root,{base:options.base||'HEAD',shadow:true,capture:true});
        result.summary=implementations.summarizeFirstRun(result.verification);
        result.next=['testlore report','Review the retained full-run outcomes and uncertainties before permitting omissions.','testlore mappings --json'];
      }
      break;
    }
    case 'repair':
    case 'autopilot': {
      const permitted=new Set(['root','json','local','sources','deadline-ms','base-branch','patch','provider']);
      if(Object.keys(options).some(key=>!permitted.has(key)))throw new Error(`${command} accepts only --root, --json, --local, --sources, --deadline-ms, --base-branch, --patch and --provider`);
      const {spawnSync}=await import('node:child_process');
      let agent=readConfig(root).agent;
      if(!agent&&!options.patch){const probe=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000,shell:false});if(!probe.error&&probe.status===0)agent=[process.execPath,fileURLToPath(new URL('./adapters/codex.js',import.meta.url))];}
      const patchFile=options.patch?safePath(root,options.patch):null;
      if(patchFile&&fs.statSync(patchFile).size>128*1024)throw new Error('Repair patch exceeds 128 KiB');
      const repairOptions={agent,sourcePaths:options.sources?.split(',').filter(Boolean),deadlineMs:options['deadline-ms']===undefined?undefined:Number(options['deadline-ms']),patch:patchFile?JSON.parse(fs.readFileSync(patchFile,'utf8')):undefined};
      const pipelineStarted=performance.now(),pipelineBudget=repairOptions.deadlineMs??900000,remainingPipeline=()=>Math.max(0,Math.floor(pipelineBudget-(performance.now()-pipelineStarted)));
      result=await repair(root,repairOptions);
      if(command==='autopilot'&&!patchFile&&(result.status==='no-failures'||result.status==='unsupported-repair-evidence'||result.status==='baseline-incomplete'&&result.detection?.discovery?.complete&&!result.detection.discovery.files.length)){
        const detection={status:result.status,receipt:result.receipt,sourceRepairSupported:result.status!=='unsupported-repair-evidence'};
        const config=readConfig(root);
        if(config.investigation?.enabled===true){
          if(remainingPipeline()<100)result={kind:'repository-immunity',status:'investigation-incomplete',published:false,merged:false,next:['The shared autopilot deadline is exhausted; no new probe or model work started.']};
          else{
            const {investigateBugs,readInvestigationInput}=await import('./bug-investigation.js'),investigation=await investigateBugs(root,{manifest:config.investigation.manifest,execute:true,deadlineMs:remainingPipeline()}),ownership=repairOptions.sourcePaths??config.repair?.sourcePaths,finding=investigation.findings.find(item=>item.outcome==='reproduced'&&(!ownership||ownership.includes(item.module))),outsideOwnership=investigation.findings.some(item=>item.outcome==='reproduced')&&!finding;
            if(finding&&remainingPipeline()>=100){const {repairInvestigation}=await import('./investigation-repair.js');result=await repairInvestigation(root,{report:investigation.receipt,reportSha256:readInvestigationInput(root,investigation.receipt).sha256,findingId:finding.id,agent,deadlineMs:remainingPipeline()});}
            else result={kind:'repository-immunity',status:outsideOwnership?'awaiting-repair-ownership':investigation.exitCode===2||finding?'investigation-incomplete':'no-reproduced-bug',published:false,merged:false,investigation,next:[outsideOwnership?'Reproduced findings are outside the approved repair.sourcePaths or --sources; review production ownership before repair.':finding?'The shared autopilot deadline is exhausted; preserve the finding and retry its bounded repair.':investigation.nextAction]};
          }
        }else result=await improve(root,{agent,provider:options.provider});
        result.autopilotDetection=detection;
      }
      if(options.provider&&result.kind==='source-repair')result.generationProviderRequest={provider:options.provider,applied:false,reason:'Author-provider selection applies to test generation. Source repair retains dedicated JSON-worker roles.'};
      if(result.status==='ready-for-review'&&!options.local){try{result=publishImprovement(root,result,{baseBranch:options['base-branch']});}catch(error){result={...result,published:false,publicationError:error.message};}}
      if(result.receipt)fs.writeFileSync(result.receipt,JSON.stringify(result,null,2));
      break;
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
    case 'campaign': {
      if(Object.keys(options).some(key=>!['root','manifest','json'].includes(key)))throw new Error('campaign accepts only --root, --manifest and --json; it replays existing captures');
      if(!options.manifest)throw new Error('--manifest is required');
      result=assessCommunityCampaignFile(root,options.manifest);break;
    }
    case 'pilot': if(!options.manifest)throw new Error('--manifest is required');result=pilot(root,JSON.parse(fs.readFileSync(path.resolve(root,options.manifest),'utf8')),{...options,unifiedNative:options['unified-native']===true});break;
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
      const {spawnSync} = await import('node:child_process');
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
    case 'init': result = init(root, implementations); break;
    case 'audit': result = audit(root); break;
    case 'plan': result = plan(root, options); break;
    case 'run': result = options['unified-native'] ? await runUnifiedNative(root, { ...options, capture: true }) : run(root, { ...options, capture: true }); result.summary=implementations.summarizeFirstRun(result); break;
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
  console.log(options.json ? JSON.stringify(result, null, 2) : human(command, result, implementations));
  if(command==='knowledge-import')return result.imported?0:2;
  if(command==='probe-qualify')return result.qualified?0:2;
  if(['investigate','immunity'].includes(command))return result.exitCode??0;
  if(command==='investigation-outcome')return result.recorded?0:2;
  if(['investigation-links','investigation-learn'].includes(command))return result.reason?2:0;
  if(['knowledge','knowledge-reflect'].includes(command))return result.reason?.startsWith('invalid-')?2:0;
  if(command==='observe')return result.exitCode ?? 2;
  if(command==='loop-status')return result.valid && result.complete ? 0 : 2;
  if(command==='challenge')return result.supported ? 0 : 1;
  if(['improve','repair','autopilot','investigation-repair'].includes(command))return result.status==='no-reproduced-bug'?0:result.status==='ready-for-review'&&(options.local||result.published)?0:2;
  if(command==='plugins' && options.check)return result.exitCode || 0;
  if(command==='assess')return result.exitCode;
  if(command==='campaign')return result.attempts.some(item=>!item.regressionQualified)?2:0;
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
  if(command==='setup'&&options.verify)return result.verification.exitCode||(!result.verification.complete?2:0);
  return 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`TestLore: ${error.message}`); process.exitCode = 2; }
}
