#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { listFiles, safePath, SOURCE, TEST, readConfig } from '../files.js';

import { snapshot, freshness, digest } from '../provenance.js';

// Resolve executable and actual Node script operands before changing cwd.
export function aqeCommand(root, command = ['aqe']) {
  if (!Array.isArray(command) || !command.length || command.some(v => typeof v !== 'string' || !v)) throw new Error('AQE command must be an argv array');
  const argv = [...command];
  const local = path.join(root,'node_modules','.bin',argv[0]);
  if (!path.isAbsolute(argv[0]) && (argv[0].includes('/') || argv[0].includes('\\'))) argv[0]=path.resolve(root,argv[0]);
  else if (!path.isAbsolute(argv[0]) && fs.existsSync(local)) argv[0]=local;
  else if (!path.isAbsolute(argv[0])) {
    const found=(process.env.PATH||'').split(path.delimiter).map(dir=>path.resolve(dir,argv[0])).find(file=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}});
    if(found)argv[0]=found;
  }
  if(fs.existsSync(argv[0]))argv[0]=fs.realpathSync(argv[0]);
  if(/^node(?:\.exe)?$/.test(path.basename(argv[0]))) {
    const valueFlags=new Set(['--require','-r','--import','--loader','--experimental-loader','--conditions','-C','--input-type','--inspect-port','--title']);
    let index=1;
    while(index<argv.length && argv[index].startsWith('-')) {
      if(['-e','--eval','-p','--print'].includes(argv[index]) || /^(?:--eval|--print)=/.test(argv[index]))return argv;
      if(argv[index]==='--'){index++;break;}
      index+=valueFlags.has(argv[index])?2:1;
    }
    if(index<argv.length){const script=path.resolve(root,argv[index]);if(fs.existsSync(script)&&fs.statSync(script).isFile())argv[index]=fs.realpathSync(script);}
  }
  return argv;
}

// AQE's actual CLI is a direct generation interface, not our JSON worker protocol.
export function aqeCapabilities(command = ['aqe']) {
  if (!Array.isArray(command) || !command.length || command.some(v => typeof v !== 'string' || !v)) throw new Error('AQE command must be an argv array');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'tddswarm-aqe-capabilities-'));
  let result;
  try{result=spawnSync(command[0], [...command.slice(1), 'test', '--help'], { env:{PATH:process.env.PATH,HOME:home,TMPDIR:os.tmpdir()}, encoding: 'utf8', shell: false, timeout: 15000, killSignal:'SIGKILL', maxBuffer: 1024 * 1024 });}
  finally{fs.rmSync(home,{recursive:true,force:true});}
  const output = result.stdout || '';
  const generation = result.status === 0 && /generate/.test(output) && /--framework/.test(output) && /--format/.test(output) && /--output/.test(output);
  return { adapter: 'agentic-qe-cli', available: generation, generation, workerRoles: [], command, exitCode: result.status ?? 2, error: result.error?.message || (!generation ? 'Installed AQE does not expose the supported generation CLI contract' : undefined) };
}
export function aqeGenerate(root, options = {}) {
  root = path.resolve(root);
  if (options.role) throw new Error('AQE CLI does not implement TestLore architect/author/reviewer JSON roles. Use aqeGenerate directly.');
  const command = aqeCommand(root,options.command || ['aqe']);
  const timeoutMs=options.timeoutMs??120000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Error('AQE timeoutMs must be an integer from 1 to 120000');
  const framework = options.framework || 'vitest';
  if (!['vitest', 'jest', 'mocha', 'pytest', 'node'].includes(framework)) throw new Error('Unsupported AQE framework');
  const target = options.target;
  if (typeof target !== 'string' || !SOURCE.test(target)) throw new Error('AQE target must be a project source file');
  safePath(root, target);
  const provenance=snapshot(root,readConfig(root));
  const id=randomUUID(), directory=safePath(root,`.tddswarm/candidates/${id}`);fs.mkdirSync(directory,{recursive:true});
  const secretValues=Object.values(options.env||{}).filter(value=>typeof value==='string'&&value);
  const redact=value=>typeof value==='string'?secretValues.reduce((text,secret)=>text.split(secret).join('[REDACTED]'),value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item)])):value;
  const retain = report => {const receipt=redact({id,directory,provenance,files:[],applied:false,measured:{execution:false,mutation:false},...report});fs.writeFileSync(path.join(directory,'aqe-review.json'),JSON.stringify(receipt,null,2));return receipt;};
  const capabilities=aqeCapabilities(command);
  if(!capabilities.available)return retain({...capabilities,executed:false,complete:false,status:'generation-failed'});
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-aqe-')));
  try {
    // Repository source is copied into a disposable workspace. AQE cannot overwrite project tests.
    for (const file of listFiles(root).filter(v => SOURCE.test(v) && !/(?:^|\/)(?:secrets?|credentials?)(?:\.|\/)/i.test(v))) {
      const source = safePath(root, file); if (fs.statSync(source).size > 256 * 1024) continue;
      const destination = safePath(workspace, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
    }
    if (!fs.existsSync(safePath(workspace, target))) throw new Error('AQE target unavailable in bounded source context');
    const output = path.join(workspace, 'aqe-result.json');
    const argv = [...command.slice(1), 'test', 'generate', target, '--framework', framework, '--format', 'json', '--output', output];
    // No inherited API keys or personal AQE configuration. Explicit environment is opt-in.
    const env = { PATH: process.env.PATH, HOME: workspace, TMPDIR: os.tmpdir(), ...(options.env || {}) };
    const result = spawnSync(command[0], argv, { cwd: workspace, env, encoding: 'utf8', shell: false, timeout: timeoutMs, killSignal:'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
    if (result.error || result.status !== 0) return retain({ adapter: 'agentic-qe-cli', complete: false, executed: true, status:'generation-failed', exitCode: result.status ?? 2, error: result.error?.message || `AQE exited ${result.status}`, stderr: result.stderr });
    if (!fs.existsSync(output) || fs.statSync(output).size > 2 * 1024 * 1024) throw new Error('AQE did not produce a bounded JSON generation artifact');
    const generated = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (!Array.isArray(generated.tests) || !generated.tests.length || generated.tests.length > 50) throw new Error('AQE artifact must contain 1–50 tests');
    const files = new Map();
    for (const test of generated.tests) {
      const relative = path.relative(workspace, path.resolve(workspace, test.testFile || '')).split(path.sep).join('/');
      if (!TEST.test(relative) || relative.split('/').some(part=>['.git','.tddswarm','node_modules','..','.',''].includes(part)) || typeof test.testCode !== 'string' || Buffer.byteLength(test.testCode) > 128 * 1024) throw new Error('AQE returned invalid candidate code');
      safePath(workspace, relative);
      // Normalize absolute scratch imports into portable relative paths; validation remains required.
      const code = test.testCode.replace(/(['"])([^'"\n]+)\1/g, (match, quote, specifier) => {
        if (!specifier.startsWith(workspace + path.sep)) return match;
        const destination = path.relative(path.dirname(path.join(workspace, relative)), specifier).split(path.sep).join('/');
        return quote + (destination.startsWith('.') ? destination : './' + destination) + quote;
      });
      if(secretValues.some(secret=>code.includes(secret)))throw new Error('AQE returned provider credential in candidate code');
      if (files.has(relative) && files.get(relative) !== code) throw new Error('AQE returned conflicting candidate files');
      files.set(relative, code);
    }
    for (const [file, content] of files) { const destination = safePath(directory, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content, { flag: 'wx' }); }
    const report = { adapter: 'agentic-qe-cli', executed: true, complete: true, exitCode: 0, id, directory, files: [...files.keys()], fileHashes:Object.fromEntries([...files].map(([file,content])=>[file,digest(content)])), provenance, status: 'unreviewed-candidates', applied: false, measured: { execution: false, mutation: false }, upstream: { coverageEstimate: generated.coverageEstimate, llmEnhanced: generated.tests.every(t => t.llmEnhanced === true), qualityGates: generated.tests.map(t => t.qualityGateResult || null) }, limitations: ['AQE coverageEstimate and qualityGateResult are upstream estimates, not TestLore measurements.', 'Candidates require independent oracle review and isolated execution.'] };
    const fresh=freshness(provenance,snapshot(root,readConfig(root)));
    if(!fresh.fresh){report.complete=false;report.status='generation-failed';report.error='AQE source provenance changed: '+fresh.reasons.join(', ');}
    return retain(report);
  } catch(error) {const receipt=retain({adapter:'agentic-qe-cli',executed:true,complete:false,status:'generation-failed',error:error.message});const failure=new Error(redact(error.message));failure.artifact=receipt;throw failure;} finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}
