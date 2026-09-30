#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, modules, plan, generate, run } from './index.js';
import { safePath } from './files.js';

const help = `TDDSwarm — know why each test runs.

Usage: tddswarm <command> [options]

  init        Create configuration and a local health report (never overwrite)
  audit       Grade static test structure; report what has not been measured
  plan        Explain which tests a Git change can affect
  run         Execute the planned tests and preserve the runner's exit code
  modules     Propose test groups and flag broad dependencies
  generate    Produce an agent work order; --execute stages reviewed candidates
  demo        Show a copy-only change, a shared change, and a conservative fallback

Options:
  --root <directory>  Project directory (default: current directory)
  --base <git-ref>    Compare base to working tree, including untracked files
  --changed <paths>   Comma-separated paths for a diagnostic plan (not run)
  --full             Force the full discovered test suite
  --shadow           Run the full suite while recording the proposed selection
  --execute          Invoke the configured agent (generate only)
  --json             Machine-readable output

Supported analysis: JavaScript / TypeScript. Runtime and service dependencies
need explicit declarations. No AI account required for audit, plan, or run.
`;

export function parseArgs(args) {
  const options = {};
  let command = 'help';
  const values = new Set(['root', 'base', 'changed']);
  const flags = new Set(['json', 'full', 'shadow', 'execute', 'help', 'version']);
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
    fs.writeFileSync(file, JSON.stringify({ runner, alwaysRun: [], dependencies: {}, ignoreChanges: [], fullRunEvery: 20 }, null, 2) + '\n', { flag: 'wx' });
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
  if (command === 'audit') return `${result.testFiles} test files · static triage grade ${result.grade}${result.score === null ? '' : ` (${result.score}/100)`}\nExecution, coverage, mutation effectiveness, flakiness, and speed: not measured.\n${result.files.flatMap(f => f.findings.map(x => `  ${f.file}:${x.line} — ${x.message}`)).join('\n')}\n${result.sourcesWithoutImportingTests.length} source files have no importing tests (not a coverage result).`;
  if (command === 'plan') return `${result.mode.toUpperCase()} · ${result.selected.length}/${result.total} test files selected\n${result.reasons.length ? `Reasons: ${result.reasons.join(', ')}\n` : ''}${result.decisions.map(d => `${d.selected ? 'RUN ' : 'SKIP'} ${d.test} — ${d.reasons.join(', ')}${d.paths.length ? `\n     ${d.paths.map(p => p.join(' → ')).join('\n     ')}` : ''}`).join('\n')}\nStatic evidence; runtime dependencies require declarations.`;
  if (command === 'run') return `${human('plan', result.plan)}\n${result.error || (result.executed ? `Runner exited ${result.exitCode}${result.shadow ? ' (shadow: full suite)' : ''} in ${result.durationMs} ms.` : 'No tests selected.')}`;
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
  return command === 'run' ? result.exitCode : 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`TDDSwarm: ${error.message}`); process.exitCode = 2; }
}
