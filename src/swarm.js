import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stagePatch } from './candidates.js';
import { snapshot } from './provenance.js';
import { buildGraph } from './graph.js';
import { audit } from './audit.js';
import { TEST, readConfig, safePath } from './files.js';

export function workOrder(root) {
  const graph = buildGraph(root);
  const report = audit(root);
  const subjects = report.sourcesWithoutImportingTests.length ? report.sourcesWithoutImportingTests : Object.keys(graph.sources).filter(f => !TEST.test(f));
  return {
    schemaVersion: 1, purpose: report.testFiles ? 'improve-existing-tests' : 'bootstrap-tests',
    subjects, audit: report,
    roles: ['architect', 'author', 'reviewer'],
    acceptance: ['Use requirements or independent invariants for expected behavior.', 'Cover boundary/error cases and observable behavior.', 'Keep tests deterministic and independent.', 'Preserve integration coverage.', 'Return candidates for review; execution and mutation quality are not yet measured.'],
    protocol: 'JSON on stdin, JSON on stdout. See docs/agents.md.',
    executed: false
  };
}

export function callAgent(command, payload, root, timeout = 120000) {
  return new Promise((resolve, reject) => {
    // argv-only execution; no shell interpolation of prompts or filenames.
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' });
    let out = '', err = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const kill = () => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { kill(); finish(new Error('Agent timed out')); }, timeout);
    child.stdout.on('data', data => {
      out += data;
      if (Buffer.byteLength(out) > 2 * 1024 * 1024) { kill(); finish(new Error('Agent output exceeds 2 MB')); }
    });
    child.stderr.on('data', data => { if (err.length < 2000) err += data; });
    child.on('error', finish);
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`Agent exited ${code}: ${err.slice(0, 2000)}`));
      try { finish(null, JSON.parse(out)); } catch { finish(new Error('Agent must return one JSON object on stdout')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function generate(root, options = {}) {
  const order = workOrder(root);
  const config = readConfig(root);
  if (!options.execute) return order;
  const agent=config.agent||options.agent;
  if (!agent) throw new Error('Configure an agent executable in tddswarm.config.json before --execute. See docs/agents.md.');
  const graph = buildGraph(root);
  const provenance = snapshot(root,config);
  // Send only source/test files, never environment files or arbitrary repository data.
  const context = Object.entries(graph.sources).filter(([file]) => !/(?:^|\/)(?:secrets?|credentials?)(?:\.|\/)/i.test(file)).map(([file, content]) => ({ file, content }));
  const requirementsPath = path.join(root, 'tddswarm.requirements.md');
  const requirements = fs.existsSync(requirementsPath) ? fs.readFileSync(safePath(root, 'tddswarm.requirements.md'), 'utf8') : '';
  if (!requirements.trim()) throw new Error('Add tddswarm.requirements.md with independent behavior expectations before --execute.');
  if (Buffer.byteLength(JSON.stringify(context)) + Buffer.byteLength(requirements) > 256 * 1024) throw new Error('Agent context exceeds 256 KB. Scope this run to a smaller project.');
  const architectural = await callAgent(agent, { schemaVersion: 1, role: 'architect', order, requirements, context }, root);
  if (!Array.isArray(architectural.tasks) || !architectural.tasks.length || architectural.tasks.length > 12) throw new Error('Architect must return 1–12 tasks');
  for (const task of architectural.tasks) {
    if (typeof task.subject !== 'string' || !graph.sources[task.subject] || typeof task.instructions !== 'string' || task.instructions.length > 20000) throw new Error('Invalid architect task');
  }
  // Three authors at a time; maximum 12 tasks + architect + reviewer = 14 calls.
  const drafts = [];
  for (let offset = 0; offset < architectural.tasks.length; offset += 3) {
    const batch = await Promise.all(architectural.tasks.slice(offset, offset + 3).map(task => callAgent(agent, { schemaVersion: 1, role: 'author', task, requirements, context }, root)));
    drafts.push(...batch);
  }
  const candidates = drafts.flatMap(d => {
    if (!Array.isArray(d.files)) throw new Error('Author must return a files array');
    return d.files;
  });
  if (!candidates.length || candidates.length > 50) throw new Error('Expected 1–50 candidate test files');
  const paths = new Set();
  for (const f of candidates) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || Buffer.byteLength(f.content) > 128 * 1024 || !TEST.test(f.path)) throw new Error('Candidate must be a test path and <=128 KB of text');
    safePath(root, f.path);
    if (paths.has(f.path)) throw new Error(`Duplicate candidate path: ${f.path}`);
    paths.add(f.path);
  }
  const review = await callAgent(agent, { schemaVersion: 1, role: 'reviewer', requirements, context, files: candidates, acceptance: order.acceptance }, root);
  if (typeof review.accepted !== 'boolean' || !Array.isArray(review.findings) || review.findings.some(f => typeof f !== 'string')) throw new Error('Reviewer must return accepted:boolean and findings:string[]');
  const staged=stagePatch(root,{files:candidates,delete:[],review,requirements,provenance,purpose:order.purpose});
  const result = { ...order, ...staged, executed: true, calls: architectural.tasks.length + 2 };
  fs.writeFileSync(path.join(staged.directory,'review.json'),JSON.stringify(result,null,2));
  return result;
}
