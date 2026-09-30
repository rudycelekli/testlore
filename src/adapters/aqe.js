#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { listFiles, safePath, SOURCE, TEST } from '../files.js';

// AQE's actual CLI is a direct generation interface, not our JSON worker protocol.
export function aqeCapabilities(command = ['aqe']) {
  if (!Array.isArray(command) || !command.length || command.some(v => typeof v !== 'string' || !v)) throw new Error('AQE command must be an argv array');
  const result = spawnSync(command[0], [...command.slice(1), 'test', '--help'], { encoding: 'utf8', shell: false, timeout: 15000, maxBuffer: 1024 * 1024 });
  const output = result.stdout || '';
  const generation = result.status === 0 && /generate/.test(output) && /--framework/.test(output) && /--format/.test(output) && /--output/.test(output);
  return { adapter: 'agentic-qe-cli', available: generation, generation, workerRoles: [], command, exitCode: result.status ?? 2, error: result.error?.message || (!generation ? 'Installed AQE does not expose the supported generation CLI contract' : undefined) };
}
export function aqeGenerate(root, options = {}) {
  root = path.resolve(root);
  if (options.role) throw new Error('AQE CLI does not implement TestLore architect/author/reviewer JSON roles. Use aqeGenerate directly.');
  const command = options.command || ['aqe']; const capabilities = aqeCapabilities(command);
  if (!capabilities.available) return { ...capabilities, executed: false, complete: false };
  const framework = options.framework || 'vitest';
  if (!['vitest', 'jest', 'mocha', 'pytest', 'node'].includes(framework)) throw new Error('Unsupported AQE framework');
  const target = options.target;
  if (typeof target !== 'string' || !SOURCE.test(target)) throw new Error('AQE target must be a project source file');
  safePath(root, target);
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-aqe-')));
  const id = randomUUID();
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
    const result = spawnSync(command[0], argv, { cwd: workspace, env, encoding: 'utf8', shell: false, timeout: options.timeoutMs || 120000, maxBuffer: 2 * 1024 * 1024 });
    if (result.error || result.status !== 0) return { adapter: 'agentic-qe-cli', complete: false, executed: true, exitCode: result.status ?? 2, error: result.error?.message || `AQE exited ${result.status}`, stderr: result.stderr };
    if (!fs.existsSync(output) || fs.statSync(output).size > 2 * 1024 * 1024) throw new Error('AQE did not produce a bounded JSON generation artifact');
    const generated = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (!Array.isArray(generated.tests) || !generated.tests.length || generated.tests.length > 50) throw new Error('AQE artifact must contain 1–50 tests');
    const files = new Map();
    for (const test of generated.tests) {
      const relative = path.relative(workspace, path.resolve(workspace, test.testFile || '')).split(path.sep).join('/');
      if (!TEST.test(relative) || typeof test.testCode !== 'string' || Buffer.byteLength(test.testCode) > 128 * 1024) throw new Error('AQE returned invalid candidate code');
      safePath(workspace, relative);
      // Normalize absolute scratch imports into portable relative paths; validation remains required.
      const code = test.testCode.replace(/(['"])([^'"\n]+)\1/g, (match, quote, specifier) => {
        if (!specifier.startsWith(workspace + path.sep)) return match;
        const destination = path.relative(path.dirname(path.join(workspace, relative)), specifier).split(path.sep).join('/');
        return quote + (destination.startsWith('.') ? destination : './' + destination) + quote;
      });
      if (files.has(relative) && files.get(relative) !== code) throw new Error('AQE returned conflicting candidate files');
      files.set(relative, code);
    }
    const directory = safePath(root, `.tddswarm/candidates/${id}`); fs.mkdirSync(directory, { recursive: true });
    for (const [file, content] of files) { const destination = safePath(directory, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content, { flag: 'wx' }); }
    const report = { adapter: 'agentic-qe-cli', executed: true, complete: true, exitCode: 0, id, directory, files: [...files.keys()], status: 'unreviewed-candidates', applied: false, measured: { execution: false, mutation: false }, upstream: { coverageEstimate: generated.coverageEstimate, llmEnhanced: generated.tests.every(t => t.llmEnhanced === true), qualityGates: generated.tests.map(t => t.qualityGateResult || null) }, limitations: ['AQE coverageEstimate and qualityGateResult are upstream estimates, not TestLore measurements.', 'Candidates require independent oracle review and isolated execution.'] };
    fs.writeFileSync(path.join(directory, 'aqe-review.json'), JSON.stringify(report, null, 2)); return report;
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}
