// Diagnostic preload only. Never used by production CLI or timing samples.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
const output = process.env.TESTLORE_CLI_PROFILE_TRACE;
if (!output || !path.isAbsolute(output)) throw new Error('Absolute diagnostic trace output is required');
const started = performance.now(), cpu = process.cpuUsage();
const imports = [], processes = [];
let hashCalls = 0, hashedBytes = 0, hashOperationMs = 0, truncated = false;
registerHooks({load(url, context, nextLoad) {
  const start = performance.now();
  try {return nextLoad(url, context);} finally {
    if (imports.length < 1000) imports.push({url, loadHookMs: performance.now() - start}); else truncated = true;
  }
}});
for (const name of ['execFileSync', 'spawnSync']) {
  const original = childProcess[name];
  childProcess[name] = function(program, ...args) {
    const start = performance.now();
    try {return original.call(this, program, ...args);} finally {
      if (processes.length < 1000) processes.push({method: name, program: path.basename(String(program)), durationMs: performance.now() - start}); else truncated = true;
    }
  };
}
const spawn = childProcess.spawn;
childProcess.spawn = function(program, ...args) {
  const started = performance.now(), child = spawn.call(this, program, ...args);
  const row = {method: 'spawn', program: path.basename(String(program)), durationMs: null, complete: false};
  if (processes.length < 1000) processes.push(row); else truncated = true;
  child.once('close', (exitCode, signal) => {row.durationMs = performance.now() - started; row.exitCode = exitCode; row.signal = signal; row.complete = true;});
  return child;
};
const createHash = crypto.createHash;
crypto.createHash = function(...args) {
  hashCalls++;
  const object = createHash.apply(this, args), update = object.update, digest = object.digest;
  object.update = function(data, encoding) {
    const start = performance.now();
    if (typeof data === 'string') hashedBytes += Buffer.byteLength(data, encoding);
    else if (ArrayBuffer.isView(data)) hashedBytes += data.byteLength;
    try {return update.call(this, data, encoding);} finally {hashOperationMs += performance.now() - start;}
  };
  object.digest = function(...values) {
    const start = performance.now();
    try {return digest.apply(this, values);} finally {hashOperationMs += performance.now() - start;}
  };
  return object;
};
syncBuiltinESMExports();
process.once('exit', code => {
  fs.writeFileSync(output, JSON.stringify({schemaVersion: 1, kind: 'cli-diagnostic-profile', exitCode: code,
    elapsedAfterPreloadMs: performance.now() - started, cpuAfterPreload: process.cpuUsage(cpu),
    imports, processes, hashes: {calls: hashCalls, bytes: hashedBytes, operationMs: hashOperationMs}, truncated,
    limitations: ['Instrumented diagnostic; excluded from uninstrumented timing samples.',
      'Load-hook spans cover source loading, not full JavaScript compilation or evaluation.',
      'Child-process spans include its startup and execution; native resolver startup is not isolated.',
      'Hash operation spans are instrumented parent operations only; child work is excluded.']}, null, 2), {flag: 'wx', mode: 0o600});
});
