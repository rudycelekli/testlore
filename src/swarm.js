import {qualityAgent} from './agent-profile.js';
import {recallLessons} from './learning.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stagePatch } from './candidates.js';
import { snapshot, freshness, digest } from './provenance.js';
import { buildGraph } from './graph.js';
import { audit } from './audit.js';
import { TEST, readConfig, safePath } from './files.js';
import { aqeGenerate } from './adapters/aqe.js';

export function workOrder(root) {
  const graph = buildGraph(root);
  const report = audit(root);
  const subjects = report.sourcesWithoutImportingTests.length ? report.sourcesWithoutImportingTests : Object.keys(graph.sources).filter(f => !TEST.test(f) && !graph.tests.includes(f));
  return {
    schemaVersion: 1, agentProfile:qualityAgent(root), purpose: report.testFiles ? 'improve-existing-tests' : 'bootstrap-tests',
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
  const aqe=config.plugins?.['agentic-qe'];
  if(options.plugin!==undefined && options.plugin!=='agentic-qe')throw new Error('Unsupported generation plugin');
  if(options.plugin==='agentic-qe' && aqe?.enabled!==true)throw new Error('Enable the agentic-qe plugin before selecting it');
  const plugin=aqe?.enabled===true ? aqe : null;
  order.generationProvider=plugin?'agentic-qe':'json-worker';
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
  const authorEnvironment={};
  if(plugin && plugin.envNames!==undefined){
    const allowed=new Set(['OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_AI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OPENROUTER_API_KEY']);
    if(!Array.isArray(plugin.envNames)||plugin.envNames.some(name=>!allowed.has(name)))throw new Error('AQE envNames must contain supported provider variable names');
    for(const name of plugin.envNames){if(typeof process.env[name]!=='string'||!process.env[name].trim())throw new Error('AQE provider variable is unavailable: '+name);authorEnvironment[name]=process.env[name];}
  }
  const learning = recallLessons(root, (requirements+' '+order.subjects.join(' ')).slice(0,4096), {limit:5,maxChars:12000,config});
  const architectural = await callAgent(agent, { schemaVersion: 1, role: 'architect', order, requirements, context, learning }, root);
  if (!Array.isArray(architectural.tasks) || !architectural.tasks.length || architectural.tasks.length > 12) throw new Error('Architect must return 1–12 tasks');
  for (const task of architectural.tasks) {
    if (typeof task.subject !== 'string' || !graph.sources[task.subject] || (plugin && (TEST.test(task.subject) || graph.tests.includes(task.subject))) || !context.some(file=>file.file===task.subject) || typeof task.instructions !== 'string' || task.instructions.length > 20000) throw new Error('Invalid architect task');
  }
  const drafts = [], artifacts=[];
  if(plugin) {
    // AQE is an author CLI only. The worker still owns scope and independent review.
    for(const task of architectural.tasks) {
      const beforeAuthor=freshness(provenance,snapshot(root,config));
      if(!beforeAuthor.fresh)throw new Error('Generation source provenance changed: '+beforeAuthor.reasons.join(', '));
      const artifact=aqeGenerate(root,{target:task.subject,command:plugin.command,framework:plugin.framework,timeoutMs:plugin.timeoutMs,env:authorEnvironment});
      artifacts.push(artifact);
      if(!artifact.complete || !artifact.executed || artifact.status!=='unreviewed-candidates')throw new Error('AQE generation failed; retained artifact '+artifact.directory+': '+(artifact.error||'incomplete generation'));
      const fresh=freshness(artifact.provenance,snapshot(root,config));
      if(!fresh.fresh)throw new Error('AQE artifact provenance is stale: '+fresh.reasons.join(', '));
      if(!Array.isArray(artifact.files)||!artifact.files.length||artifact.files.length>50)throw new Error('AQE artifact scope is invalid');
      const files=artifact.files.map(file=>{
        safePath(root,file);
        if(!TEST.test(file)||file.split('/').some(part=>['.git','.tddswarm','node_modules','.',''].includes(part)))throw new Error('AQE artifact requires a valid test path');
        const content=fs.readFileSync(safePath(artifact.directory,file),'utf8');
        if(Buffer.byteLength(content)>128*1024 || digest(content)!==artifact.fileHashes?.[file])throw new Error('AQE artifact content changed: '+file);
        return {path:file,content};
      });
      drafts.push({files});
    }
  } else {
    // Three authors at a time; maximum 12 tasks + architect + reviewer = 14 calls.
    for (let offset = 0; offset < architectural.tasks.length; offset += 3) {
      const batch = await Promise.all(architectural.tasks.slice(offset, offset + 3).map(task => callAgent(agent, { schemaVersion: 1, role: 'author', agentProfile:order.agentProfile, task, requirements, context, learning:recallLessons(root,(task.subject+' '+task.instructions+' '+requirements).slice(0,4096),{limit:3,maxChars:8000,config}) }, root)));
      drafts.push(...batch);
    }
  }
  let candidates = drafts.flatMap(d => {
    if (!Array.isArray(d.files)) throw new Error('Author must return a files array');
    return d.files;
  });
  if(plugin){
    const merged=new Map();
    for(const file of candidates){if(merged.has(file.path)&&merged.get(file.path)!==file.content)throw new Error('Conflicting AQE candidate path: '+file.path);merged.set(file.path,file.content);}
    candidates=[...merged].map(([path,content])=>({path,content}));
  }
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
  const result = { ...order, ...staged, executed: true, calls: plugin?2:architectural.tasks.length + 2, ...(plugin?{generation:{provider:'agentic-qe',authorCalls:artifacts.length,artifacts}}:{}) };
  fs.writeFileSync(path.join(staged.directory,'review.json'),JSON.stringify(result,null,2));
  return result;
}
