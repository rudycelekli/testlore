// Local file identity only: no worker execution, credential reads or model attestation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const executableLimit = 512 * 1024 * 1024;
const sourceLimit = 8 * 1024 * 1024;
export function fileIdentity(filename, maximumBytes = sourceLimit) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > executableLimit) throw new Error('Invalid worker identity byte budget');
  const absolute = path.resolve(filename), realpath = fs.realpathSync(absolute);
  const initial = fs.statSync(realpath);
  if (!initial.isFile() || initial.size > maximumBytes) throw new Error('Worker identity requires a bounded regular file');
  const descriptor = fs.openSync(realpath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > maximumBytes || before.dev !== initial.dev || before.ino !== initial.ino) throw new Error('Worker identity requires a bounded regular file that did not change before opening');
    const hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(1024 * 1024, maximumBytes + 1));
    let bytes = 0, length;
    while ((length = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, maximumBytes + 1 - bytes), null)) > 0) {
      bytes += length;
      if (bytes > maximumBytes) throw new Error('Worker identity file grew beyond its byte budget');
      hash.update(buffer.subarray(0, length));
    }
    const after = fs.fstatSync(descriptor);
    const retained = fs.statSync(realpath);
    if (before.size !== bytes || after.size !== bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || retained.dev !== after.dev || retained.ino !== after.ino || fs.realpathSync(absolute) !== realpath) throw new Error('Worker identity file changed while hashing');
    return { path: absolute, realpath, bytes, sha256: hash.digest('hex'), mode: after.mode };
  } finally { fs.closeSync(descriptor); }
}

// callAgent uses shell:false and inherits this PATH. Relative PATH entries and
// slash-containing commands are resolved from the child's cwd, not this module.
export function resolveWorkerExecutable(command, cwd, env = process.env) {
  if (process.platform === 'win32') throw new Error('Worker executable identity currently supports POSIX spawn resolution only');
  const candidates = command.includes('/') ? [path.resolve(cwd, command)]
    : typeof env.PATH === 'string' ? env.PATH.split(path.delimiter).map(directory => path.resolve(cwd, directory || '.', command)) : [];
  if (!candidates.length) throw new Error('Worker PATH is absent; default executable search is unbound');
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } }
    catch (error) { if (!['ENOENT','ENOTDIR','EACCES'].includes(error.code)) throw error; }
  }
  throw new Error('Worker executable cannot be resolved from invocation cwd/PATH: ' + command);
}

function nodeInvocation(argv) {
  const files = [], inline = [], unbound = [];
  let entrypoint = null, scriptIndex = null;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (['-e','--eval','-p','--print'].includes(arg) || /^(?:--eval|--print)=/.test(arg)) {
      const code = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++index];
      if (code === undefined) throw new Error('Missing Node inline worker source');
      inline.push({ argument: index, sha256: createHash('sha256').update(code).digest('hex'), bytes: Buffer.byteLength(code) });
      return { files, inline, entrypoint, scriptIndex: index, unbound: [...unbound, 'Inline worker imports and spawned children are not bound.'] };
    }
    if (arg === '--') { entrypoint = argv[++index] ?? null; scriptIndex = index; break; }
    if (['-r','--require','--import'].includes(arg) || /^(?:--require|--import)=/.test(arg)) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++index];
      if (!value) throw new Error('Missing Node preload identity');
      if (value.startsWith('.') || path.isAbsolute(value) || value.startsWith('file:')) files.push({ argument: index, value, kind: 'node-preload' });
      else unbound.push('Package-resolved Node preload is not bound: ' + value);
      continue;
    }
    if (['--input-type','--conditions','--max-old-space-size','--stack-size','--inspect-port'].includes(arg)) { index++; continue; }
    if (arg.startsWith('-')) continue;
    entrypoint = arg; scriptIndex = index; break;
  }
  if (entrypoint && entrypoint !== '-') files.push({ argument: scriptIndex, value: entrypoint, kind: 'node-entrypoint' });
  else unbound.push('Node stdin/interactive worker source is not bound.');
  return { files, inline, entrypoint, scriptIndex, unbound };
}

export function captureWorkerIdentity(argv, { cwd, env = process.env, declaration = null, controllerNode } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 32 || argv.some(arg => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg) > 4096)) throw new Error('Invalid bounded worker identity argv');
  argv = [...argv];
  cwd = path.resolve(cwd);
  const cache = new Map(), bind = (filename, maximumBytes = sourceLimit) => {
    const absolute = path.resolve(filename);
    if (!cache.has(absolute)) cache.set(absolute, fileIdentity(absolute, maximumBytes));
    return cache.get(absolute);
  };
  const launcher = bind(resolveWorkerExecutable(argv[0], cwd, env), executableLimit);
  const controller = controllerNode || bind(process.execPath, executableLimit);
  const isNode = launcher.sha256 === controller.sha256 || /^node(?:\.exe)?$/.test(path.basename(launcher.realpath));
  let node = isNode ? launcher : null, interpreter = null;
  if (!isNode) {
    const descriptor = fs.openSync(launcher.realpath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)), prefix = Buffer.alloc(512);
    let header;
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new Error('Worker launcher changed before bounded shebang read');
      header = prefix.subarray(0, fs.readSync(descriptor, prefix, 0, prefix.length, 0)).toString('utf8').split('\n')[0].trim();
    }
    finally { fs.closeSync(descriptor); }
    const shebang = /^#!\s*(\/\S+)(?:\s+(node))?$/.exec(header);
    if (shebang) {
      interpreter = bind(shebang[1], executableLimit);
      if (path.basename(shebang[1]) === 'env' && shebang[2] === 'node') node = bind(resolveWorkerExecutable('node', cwd, env), executableLimit);
      else if (path.basename(shebang[1]) === 'node' && !shebang[2]) node = interpreter;
    }
  }
  const invocation = isNode ? nodeInvocation(argv) : { files: [], inline: [], scriptIndex: 0, unbound: ['Launcher internals and spawned children are not bound.'] };
  // Only local explicit file operands are inspected. No package resolution,
  // environment/config inventory or recursive dependency reads are performed.
  const operands = [...invocation.files];
  for (let index = (invocation.scriptIndex ?? argv.length) + 1; index < argv.length; index++) {
    const value = argv[index];
    if (path.isAbsolute(value) && !operands.some(file => file.argument === index)) {
      try { if (fs.statSync(value).isFile()) operands.push({ argument: index, value, kind: 'absolute-file-argument' }); }
      catch (error) { if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  const files = operands.map(({ argument, value, kind }) => {
    const filename = value.startsWith('file:') ? fileURLToPath(value) : path.resolve(cwd, value);
    const credentialLike = /(?:^|[/\\])(?:\.env(?:\.|$)|(?:auth|credentials?|secrets?|tokens?|api[_-]?keys?)(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))/i;
    if (credentialLike.test(filename) || credentialLike.test(fs.realpathSync(filename))) throw new Error('Credential-like worker file operands cannot be identity-read');
    return { argument, kind, ...bind(filename) };
  });
  const remaining = argv.slice((invocation.scriptIndex ?? argv.length) + 1), modelIndex = remaining.findIndex(arg => arg === '--model' || arg === '-m' || arg.startsWith('--model='));
  const requestedModel = modelIndex < 0 ? null : remaining[modelIndex].startsWith('--model=') ? remaining[modelIndex].slice(8) || null : remaining[modelIndex + 1] || null;
  return { schemaVersion: 1, cwd, argv, launcher, interpreter, node: node ? { ...node, version: node.sha256 === controller.sha256 ? process.version : null, recognition: node.sha256 === controller.sha256 ? 'controller-binary-hash' : isNode ? 'launcher-filename-only' : 'simple-node-shebang' } : null,
    files, inline: invocation.inline, model: { requested: requestedModel, verified: null, operatorDeclaration: declaration, verification: 'No provider model attestation is available.' },
    verificationScope: { method: 'Bounded local file SHA-256 and resolved-path checks before launch and after response.', bound: ['Resolved worker launcher', ...(node ? ['Node launcher file'] : []), ...(interpreter ? ['Simple shebang interpreter file'] : []), ...(files.some(file => file.kind.startsWith('node-')) ? ['Explicit Node entrypoint/preload files'] : []), ...(invocation.inline.length ? ['Inline Node source'] : []), ...(files.some(file => file.kind === 'absolute-file-argument') ? ['Existing absolute file operands'] : [])], unbound: [...invocation.unbound, 'Imported dependencies, child processes, native provider runtime, configuration/environment and provider model are not fully attested.'], fullRuntimeAttestation: false } };
}

export function assertWorkerIdentity(expected, options = {}) {
  let current;
  try { current = captureWorkerIdentity(expected.argv, { ...options, cwd: expected.cwd, declaration: expected.model.operatorDeclaration }); }
  catch (error) { throw new Error('Worker identity drift: ' + error.message); }
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Worker identity drift: launcher, resolved script/file operand or invocation changed');
  return current;
}

export function assertFileIdentities(files) {
  for (const file of files) {
    let current;
    try { current = fileIdentity(file.path); }
    catch (error) { throw new Error('Implementation identity drift: ' + error.message); }
    if (JSON.stringify(current) !== JSON.stringify(file)) throw new Error('Implementation identity drift: ' + file.path);
  }
}
