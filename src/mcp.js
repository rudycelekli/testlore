import fs from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { verificationBrief, inspectVerificationStatus } from './agent-contract.js';
import { boundedSummary } from './mcp-worker.js';
import {briefInputSchema,statusInputSchema} from './mcp-inputs.js';

const workerPath = fileURLToPath(new URL('./mcp-worker.js', import.meta.url));
const baseSchema = z.string().min(1).max(200).regex(/^[^-\x00-\x1f][^\x00-\x1f]*$/).optional();
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const execution = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function errorResult(error) {
  const message = String(error.message || error).slice(0, 2000);
  return { isError: true, content: [{ type: 'text', text: message }],
    structuredContent: { complete: false, error: message, deploymentSafety: 'not-established' } };
}
function toolResult(value) {
  const result = boundedSummary(value);
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
}
function killGroup(child) {
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
}

/** MCP startup is the authority boundary. Tool arguments cannot change it. */
export async function serveMcp(options = {}) {
  const root = fs.realpathSync(options.root || process.cwd());
  const identity = fs.statSync(root);
  if (!identity.isDirectory()) throw new Error('MCP root must be a directory');
  const allowExecution = options.allowExecution === true;
  const timeoutMs = options.executionTimeoutMs ?? 300000;
  const maxOutputBytes = options.maxOutputBytes ?? 1048576;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 600000) throw new Error('MCP execution timeout must be 50..600000ms');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 4096 || maxOutputBytes > 4194304) throw new Error('Invalid MCP output bound');
  let active = null;
  function assertRoot() {
    const now = fs.statSync(root);
    if (fs.realpathSync(root) !== root || now.dev !== identity.dev || now.ino !== identity.ino)
      throw new Error('The fixed project root changed; restart the MCP server');
  }
  async function execute(operation, args, signal) {
    assertRoot();
    if (active) throw new Error('Project execution is busy; wait for the active request');
    if (signal?.aborted) throw new Error('Execution cancelled; no positive evidence was produced');
    const startedWall = Date.now(), startedMono = performance.now();
    const child = fork(workerPath, ['--internal-mcp-worker', JSON.stringify({ root, rootIdentity: { dev: identity.dev, ino: identity.ino }, operation, ...args })], {
      cwd: root, detached: process.platform !== 'win32', execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    active = child;
    return await new Promise((resolve, reject) => {
      let received = null, bytes = 0, failure = null;
      const exceeded = () => Date.now() - startedWall >= timeoutMs || performance.now() - startedMono >= timeoutMs;
      const stop = message => { if (!failure) failure = new Error(message); killGroup(child); };
      const timer = setTimeout(() => stop('Execution timed out; no positive evidence was accepted'), timeoutMs);
      const abort = () => stop('Execution cancelled; no positive evidence was accepted');
      signal?.addEventListener('abort', abort, { once: true });
      const output = chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) stop('Execution output limit exceeded; result is incomplete'); };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.on('message', message => {
        const length = Buffer.byteLength(JSON.stringify(message));
        bytes += length;
        if (bytes > maxOutputBytes) return stop('Execution output limit exceeded; result is incomplete');
        if (received) return stop('Invalid duplicate worker result');
        received = message;
      });
      child.once('error', error => {
        if (child.pid) return stop(error.message);
        clearTimeout(timer); signal?.removeEventListener('abort', abort); active = null;
        reject(error);
      });
      child.once('exit', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        // Detached descendants must not survive completion or cancellation.
        killGroup(child); active = null;
        if (exceeded()) failure ||= new Error('Execution exceeded its deadline; no positive evidence was accepted');
        if (failure) return reject(failure);
        if (received?.error) return reject(new Error(received.error));
        if (code !== 0 || !received?.result) return reject(new Error('Execution ended without a complete worker response'));
        try { assertRoot(); } catch (error) { return reject(error); }
        resolve(received.result);
      });
    });
  }
  function factory() {
    const server = new McpServer({ name: 'testlore', version: '0.1.0' }, {
      instructions: 'Start with testlore_brief. Evidence is scoped and advisory. Historical receipts do not establish current deployment safety. Execution tools are available only when explicitly enabled at server startup.'
    });
    const register = (name, description, inputSchema, annotations, callback) => server.registerTool(name,
      { description, inputSchema, annotations }, async (args, context) => {
        try { assertRoot(); const result = await callback(args, context); assertRoot(); return toolResult(result); } catch (error) { return errorResult(error); }
      });
    register('testlore_brief', 'Inspect the independent quality contract and bounded static test inventory without running project code.',
      briefInputSchema, readOnly,
      args => verificationBrief(root, args));
    register('testlore_status', 'Inspect historical verification receipts without freshness checks, native discovery, runners, or service probes.',
      statusInputSchema, readOnly, () => inspectVerificationStatus(root));
    if (allowExecution) {
      register('testlore_plan', 'Execute configured discovery/resolvers and service probes to propose routing. Requires trusted project execution enabled at startup.',
        z.strictObject({ base: baseSchema }), execution, (args, context) => execute('plan', args, context.signal));
      register('testlore_verify', 'Run configured project tests, write native receipts, and return bounded evidence. Defaults to full-suite shadow execution.',
        z.strictObject({ base: baseSchema, mode: z.enum(['shadow', 'full']).default('shadow') }), execution,
        (args, context) => execute('verify', args, context.signal));
    }
    return server;
  }
  const handle = serveStdio(factory, { onerror: error => process.stderr.write(`TestLore MCP: ${String(error.message).slice(0, 1000)}\n`) });
  const abortActive = () => { if (active) killGroup(active); };
  const shutdown = () => { abortActive(); void handle.close().catch(() => {}); };
  process.stdin.once('end', abortActive);
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  return { root, allowExecution, async close() {
    abortActive(); process.stdin.removeListener('end', abortActive);
    process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
    await handle.close();
  } };
}

export const startMcpServer = serveMcp;
