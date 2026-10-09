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
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {planGeneration,generationBindingFresh} from './generation-routing.js';

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

export function callAgent(command, payload, root, timeout = 120000, options = {}) {
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 2 * 1024 * 1024) return Promise.reject(new Error('Invalid agent transport budget'));
  const deadlineAt = Date.now() + timeout, monotonicDeadline = performance.now() + timeout;
  return new Promise((resolve, reject) => {
    // argv-only execution; no shell interpolation of prompts or filenames.
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false, ...(options.env?{env:options.env}:{}), detached: process.platform !== 'win32' });
    let out = '', err = '', settled = false, pendingError=null, killTimer;
    const finish = (error, value) => {
      if(error&&options.redactValues){let message=error.message;for(const value of options.redactValues)if(typeof value==='string'&&value)message=message.split(value).join('[REDACTED]');error=new Error(message);}
      if (settled) return; if(!error && (Date.now() >= deadlineAt || performance.now() >= monotonicDeadline))error=new Error('Agent timed out (late response rejected)'); settled = true; clearTimeout(timer);clearTimeout(killTimer);
      error ? reject(error) : resolve(value);
    };
    const kill = () => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const abort=error=>{if(pendingError||settled)return;pendingError=error;kill();killTimer=setTimeout(()=>finish(pendingError),2000);};
    const timer = setTimeout(() => abort(new Error('Agent timed out')), timeout);
    child.stdout.on('data', data => {
      out += data;
      if (Buffer.byteLength(out) > maxOutputBytes){out='';abort(new Error('Agent output exceeds declared byte budget'));}
    });
    child.stderr.on('data', data => { if (err.length < 2000) err += data; });
    child.on('error', error => { kill(); finish(error); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      kill(); // Successful parent exit must not leave a background worker changing the repository.
      if(pendingError)return finish(pendingError);
      if (Date.now() >= deadlineAt || performance.now() >= monotonicDeadline) { kill(); return finish(new Error('Agent timed out (late response rejected)')); }
      if (code !== 0) return finish(new Error(`Agent exited ${code}: ${err.slice(0, 2000)}`));
      try { const value=JSON.parse(out); if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('shape'); finish(null, value); } catch { finish(new Error('Agent must return one JSON object on stdout')); }
    });
    child.stdin.end(JSON.stringify({ ...payload, transportBudget: { deadlineAt, timeoutMs: timeout, maxOutputBytes, ...(process.platform !== 'win32' ? {processGroupId:child.pid} : {}) } }));
  });
}

export async function generate(root, options = {}) {
  const startedAt=performance.now(),startedWall=Date.now();
  const order = workOrder(root);
  const config = readConfig(root);
  const aqe=config.plugins?.['agentic-qe'];
  if(options.plugin!==undefined && options.plugin!=='agentic-qe')throw new Error('Unsupported generation plugin');
  if(options.plugin==='agentic-qe' && aqe?.enabled!==true)throw new Error('Enable the agentic-qe plugin before selecting it');
  let plan=planGeneration(root,{config,agent:config.agent||options.agent,provider:options.plugin||options.provider,dependencyMetadata:options.dependencyMetadata});
  let plugin=plan.provider==='agentic-qe'?plan.plugin:null;
  order.generationProvider=plan.provider;order.generationPlan=plan;
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
  const learning = recallLessons(root, (requirements+' '+order.subjects.join(' ')).slice(0,4096), {limit:5,maxChars:12000,config,contract:requirements});
  const totalTimeoutMs=options.totalTimeoutMs??300000;
  if(!Number.isInteger(totalTimeoutMs)||totalTimeoutMs<1||totalTimeoutMs>900000)throw new Error('Generation totalTimeoutMs must be 1–900000');
  const deadline=startedAt+totalTimeoutMs;
  const assertFresh=()=>{const check=freshness(provenance,snapshot(root,config));if(!check.fresh)throw new Error('Generation source provenance changed: '+check.reasons.join(', '));if(!generationBindingFresh(root,plan,{dependencyMetadata:options.dependencyMetadata}))throw new Error('Generation provider binding changed');};
  const remaining=(limit)=>{const value=Math.min(limit,Math.floor(deadline-performance.now()));if(value<1)throw new Error('Generation total time budget exhausted');return value;};
  const timeoutMs = options.timeoutMs ?? 120000, transport = {maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024};
  const drafts=[],artifacts=[],fallbacks=[];
  let jsonAuthorCalls=0,aqeAuthorAttempts=0,architectAttempts=0,reviewerAttempts=0;
  const runId=randomUUID(),runDirectory=safePath(root,`.tddswarm/generation/${runId}`);fs.mkdirSync(runDirectory,{recursive:true});
  const receiptPath=path.join(runDirectory,'result.json');
  const receipt=(status,error)=>{const report={schemaVersion:1,runId,status,plan,artifacts,fallbacks,jsonAuthorCalls,aqeAuthorAttempts,architectAttempts,reviewerAttempts,workerCalls:architectAttempts+reviewerAttempts+jsonAuthorCalls+aqeAuthorAttempts,cost:{tokens:null,currency:null},wallTimeMs:performance.now()-startedAt,...(error?{error}:{}),receipt:receiptPath};fs.writeFileSync(receiptPath,JSON.stringify(report,null,2));return report;};
  const bindBudget=()=>{plan.budget={totalTimeoutMs,deadlineAt:startedWall+totalTimeoutMs,maxTasks:12,maxWorkerCalls:plan.provider==='agentic-qe'&&plan.mode==='auto'?26:14,maxOutputBytes:transport.maxOutputBytes,jsonWorkerTimeoutMs:timeoutMs,maxAqeWorkerTimeoutMs:137000,maxAqeAuthorTimeoutMs:120000,processTerminationGraceMs:2000};};
  // Before tasks exist, reserve the largest bounded automatic route; final plan narrows it.
  bindBudget();if(plan.mode==='auto'&&options.provider!=='json-worker')plan.budget.maxWorkerCalls=26;
  receipt('planning');
  try{
  const architectTimeout=remaining(timeoutMs);architectAttempts++;
  receipt('architect');
  const architectural = await callAgent(agent, { schemaVersion: 1, role: 'architect', order, requirements, context, learning }, root, architectTimeout, transport);
  assertFresh();
  if (!Array.isArray(architectural.tasks) || !architectural.tasks.length || architectural.tasks.length > 12) throw new Error('Architect must return 1–12 tasks');
  for (const task of architectural.tasks) {
    if (!task || typeof task.subject !== 'string' || !graph.sources[task.subject] || (plugin && (TEST.test(task.subject) || graph.tests.includes(task.subject))) || !context.some(file=>file.file===task.subject) || typeof task.instructions !== 'string' || task.instructions.length > 20000) throw new Error('Invalid architect task');
  }
  plan=planGeneration(root,{config,agent,requirements,tasks:architectural.tasks,provider:options.plugin||options.provider,dependencyMetadata:options.dependencyMetadata});
  plugin=plan.provider==='agentic-qe'?plan.plugin:null;
  bindBudget();
  order.generationProvider=plan.provider;order.generationPlan=plan;
  if(plugin&&new Set(architectural.tasks.map(task=>task.subject)).size!==architectural.tasks.length)throw new Error('AQE architect tasks require distinct source ownership');
  receipt('authoring');
  const jsonAuthor=async task=>{assertFresh();const payload={schemaVersion:1,role:'author',agentProfile:order.agentProfile,task,requirements,context,learning:recallLessons(root,(task.subject+' '+task.instructions+' '+requirements).slice(0,4096),{limit:3,maxChars:8000,config,contract:requirements})};const limit=remaining(timeoutMs);jsonAuthorCalls++;const draft=await callAgent(agent,payload,root,limit,transport);assertFresh();return draft;};
  const aqeAuthor=async task=>{
    assertFresh();
    const limit=remaining((plugin.timeoutMs??120000)+15000+2000);
    const attempt={schemaVersion:1,subject:task.subject,status:'running',cost:{tokens:null,currency:null}};
    const attemptFile=path.join(runDirectory,`aqe-author-${aqeAuthorAttempts+1}.json`);fs.writeFileSync(attemptFile,JSON.stringify(attempt,null,2));
    const home=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-aqe-worker-'));
    try {
      aqeAuthorAttempts++;
      const response=await callAgent([process.execPath,fileURLToPath(new URL('./adapters/aqe-worker.js',import.meta.url))],{options:{target:task.subject,command:plugin.command,framework:plugin.framework,timeoutMs:Math.min(plugin.timeoutMs??120000,Math.max(1,limit-1000))},envNames:Object.keys(authorEnvironment)},root,limit,{...transport,redactValues:Object.values(authorEnvironment),env:{PATH:process.env.PATH,HOME:home,TMPDIR:os.tmpdir(),...authorEnvironment}});
      if(response.artifact)artifacts.push(response.artifact);
      if(Array.isArray(response.artifacts))artifacts.push(...response.artifacts);
      assertFresh();
      const artifact=response.artifact;
      if(response.error)throw new Error(response.error);
      if(!artifact?.complete||!artifact.executed||artifact.status!=='unreviewed-candidates')throw new Error('AQE generation failed; retained artifact '+artifact?.directory+': '+(artifact?.error||'incomplete generation'));
      const fresh=freshness(artifact.provenance,snapshot(root,config));
      if(!fresh.fresh)throw new Error('AQE artifact provenance is stale: '+fresh.reasons.join(', '));
      if(!Array.isArray(artifact.files)||!artifact.files.length||artifact.files.length>50)throw new Error('AQE artifact scope is invalid');
      attempt.status='completed';attempt.artifact=artifact.directory;fs.writeFileSync(attemptFile,JSON.stringify(attempt,null,2));
      return {files:artifact.files.map(file=>{
        safePath(root,file);
        if(!TEST.test(file)||file.split('/').some(part=>['.git','.tddswarm','node_modules','.',''].includes(part)))throw new Error('AQE artifact requires a valid test path');
        const content=fs.readFileSync(safePath(artifact.directory,file),'utf8');
        if(Buffer.byteLength(content)>128*1024||digest(content)!==artifact.fileHashes?.[file])throw new Error('AQE artifact content changed: '+file);
        return {path:file,content};
      })};
    }catch(error){attempt.status='failed';attempt.error=error.message;fs.writeFileSync(attemptFile,JSON.stringify(attempt,null,2));throw error;}finally{fs.rmSync(home,{recursive:true,force:true});}
  };
  for(let offset=0;offset<architectural.tasks.length;offset+=plan.maxParallelAuthors){
    const tasks=architectural.tasks.slice(offset,offset+plan.maxParallelAuthors);
    // Settle all independent authors before fallback, review or rejection.
    const batch=await Promise.allSettled(tasks.map(task=>plugin?aqeAuthor(task):jsonAuthor(task)));
    assertFresh();
    for(let index=0;index<batch.length;index++){
      const outcome=batch[index];
      if(outcome.status==='fulfilled'){drafts.push(outcome.value);continue;}
      if(!plugin||plan.mode==='explicit')throw outcome.reason;
      const reason=outcome.reason?.message||'AQE author failed';
      const fallback={subject:tasks[index].subject,from:'agentic-qe',to:'json-worker',reason,status:'running',cost:{tokens:null,currency:null}};fallbacks.push(fallback);receipt('fallback');
      try{drafts.push(await jsonAuthor(tasks[index]));fallback.status='completed';}catch(error){fallback.status='failed';fallback.error=error.message;throw error;}
      receipt('authoring');
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
    if(f&&typeof f.content==='string'&&Object.values(authorEnvironment).some(secret=>f.content.includes(secret)))throw new Error('Author returned provider credential in candidate code');
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || Buffer.byteLength(f.content) > 128 * 1024 || !TEST.test(f.path)) throw new Error('Candidate must be a test path and <=128 KB of text');
    safePath(root, f.path);
    if (paths.has(f.path)) throw new Error(`Duplicate candidate path: ${f.path}`);
    paths.add(f.path);
  }
  const reviewerTimeout=remaining(timeoutMs);reviewerAttempts++;receipt('reviewing');
  const review = await callAgent(agent, { schemaVersion: 1, role: 'reviewer', requirements, context, files: candidates, acceptance: order.acceptance }, root, reviewerTimeout, transport);
  assertFresh();
  if (typeof review.accepted !== 'boolean' || !Array.isArray(review.findings) || review.findings.some(f => typeof f !== 'string')) throw new Error('Reviewer must return accepted:boolean and findings:string[]');
  remaining(1);
  const staged=stagePatch(root,{files:candidates,delete:[],review,requirements,provenance,purpose:order.purpose});
  const result = { ...order, ...staged, executed: true, calls:jsonAuthorCalls+2, generation:{provider:plan.provider,authorCalls:architectural.tasks.length,workerCalls:jsonAuthorCalls+aqeAuthorAttempts+architectAttempts+reviewerAttempts,jsonAuthorCalls,aqeAuthorAttempts,architectAttempts,reviewerAttempts,receipt:receiptPath,wallTimeMs:performance.now()-startedAt,artifacts,fallbacks,cost:{tokens:null,currency:null},plan} };
  fs.writeFileSync(path.join(staged.directory,'review.json'),JSON.stringify(result,null,2));
  receipt(result.status);return result;
  }catch(error){for(const secret of Object.values(authorEnvironment))if(secret)error.message=error.message.split(secret).join('[REDACTED]');error.generation=receipt('generation-failed',error.message);throw error;}
}
