#!/usr/bin/env node
// A transparent byte relay to the exact CLI, not an MCP implementation/client.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {executableIdentity, safeHostEnvironment} from './host-qualification.js';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const receipt = {schemaVersion: 1, transport: 'transparent-stdio-relay', mode: config.mode,
  entrypoint: executableIdentity(config.entrypoint), node: executableIdentity(config.node),
  tools: null, calls: [], incomplete: false, stderr: ''};
const pending = new Map();
function persist() {fs.writeFileSync(config.receipt, JSON.stringify(receipt), {mode: 0o600});}
function observe(direction, chunk) {
  buffers[direction] += decoders[direction].write(chunk);
  if (Buffer.byteLength(buffers[direction]) > 262144) {receipt.incomplete = true; buffers[direction] = ''; persist(); return;}
  let end;
  while ((end = buffers[direction].indexOf('\n')) >= 0) {
    const line = buffers[direction].slice(0, end); buffers[direction] = buffers[direction].slice(end + 1);
    let message; try {message = JSON.parse(line);} catch {receipt.incomplete = true; continue;}
    if (direction === 'input' && message.id !== undefined) {
      if (pending.size >= 24) {receipt.incomplete = true; continue;}
      pending.set(message.id, message);
      if (message.method === 'tools/call') {
        if (receipt.calls.length >= 12) {receipt.incomplete = true; continue;}
        receipt.calls.push({id: message.id, name: message.params?.name, arguments: message.params?.arguments, requestedAt: Date.now(), result: null});
      }
    }
    if (direction === 'output' && message.id !== undefined) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (request?.method === 'tools/list') receipt.tools = (message.result?.tools || []).map(({name}) => name);
      if (request?.method === 'tools/call') {
        const call = receipt.calls.find(row => row.id === message.id);
        if (call) call.result = message.result?.structuredContent || {isError: true, error: message.error || message.result?.content};
        if (call) call.respondedAt = Date.now();
        if (message.result?.isError && call) call.isError = true;
      }
    }
    persist();
  }
}
const buffers = {input: '', output: ''};
const decoders = {input: new StringDecoder('utf8'), output: new StringDecoder('utf8')};
persist();
const child = spawn(config.node, [config.entrypoint, 'mcp', '--root', config.root,
  ...(config.mode === 'execution' ? ['--allow-execution'] : [])], {cwd: config.root,
  env: safeHostEnvironment(process.env), stdio: ['pipe', 'pipe', 'pipe'], shell: false});
process.stdin.on('data', chunk => {observe('input', chunk); child.stdin.write(chunk);});
process.stdin.on('end', () => child.stdin.end());
child.stdout.on('data', chunk => {observe('output', chunk); process.stdout.write(chunk);});
child.stderr.on('data', chunk => {receipt.stderr = (receipt.stderr + chunk.toString('utf8')).slice(0, 2000); persist();});
child.stdin.on('error', () => {});
child.once('error', error => {receipt.incomplete = true; receipt.error = error.message; persist(); process.exitCode = 1;});
child.once('exit', (code, signal) => {receipt.exitCode = code; receipt.signal = signal; persist(); process.exit(code ?? 1);});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {child.kill(signal);});
