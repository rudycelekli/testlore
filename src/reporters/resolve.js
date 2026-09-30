import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const request = JSON.parse(process.argv[2]);
const { root, file, specifier, adapter, command } = request;
const requireProject = createRequire(path.join(root, 'package.json'));
function loadPath(name) {
  try { return requireProject.resolve(name); } catch {}
  // An explicit absolute CLI can belong to a tool installation outside the project.
  for (const argument of command) if (path.isAbsolute(argument) && fs.existsSync(argument)) {
    try { return createRequire(argument).resolve(name); } catch {}
  }
  throw new Error(`Install ${name} in the project or specify its absolute runner CLI`);
}
let resolved;
try {
  if (adapter === 'jest') {
    const output = spawnSync(command[0], [...command.slice(1), '--showConfig'], { cwd: root, encoding: 'utf8', env: process.env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (output.status !== 0) throw new Error('Jest config resolution failed');
    const configs = JSON.parse(output.stdout).configs;
    const absolute = path.resolve(root, file);
    const matching = configs.length === 1 ? configs : configs.filter(c => (c.roots || [c.rootDir]).some(r => absolute.startsWith(r + path.sep)));
    if (matching.length !== 1) throw new Error('Ambiguous Jest project resolver');
    const config = matching[0];
    const module = await import(pathToFileURL(loadPath('jest-resolve')).href);
    const Resolver = module.default.default || module.default;
    let names = [specifier];
    for (const [pattern, replacements] of config.moduleNameMapper || []) {
      const regex = new RegExp(pattern);
      if (regex.test(specifier)) { names = (Array.isArray(replacements) ? replacements : [replacements]).map(r => specifier.replace(regex, r)); break; }
    }
    for (const name of names) {
      resolved = Resolver.findNodeModule(name, { basedir: path.dirname(absolute), extensions: config.moduleFileExtensions.map(x => '.' + x), moduleDirectory: config.moduleDirectories, paths: config.modulePaths, resolver: config.resolver, rootDir: config.rootDir, conditions: ['require', 'default', 'node'] });
      if (resolved) break;
    }
  } else {
    const vite = await import(pathToFileURL(loadPath('vite')).href);
    let configFile;
    for (let i = 0; i < command.length; i++) {
      if (['--config', '-c'].includes(command[i])) configFile = path.resolve(root, command[i + 1]);
      else if (command[i].startsWith('--config=')) configFile = path.resolve(root, command[i].slice(9));
    }
    configFile ||= ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs', 'vitest.config.cts', 'vitest.config.cjs'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
    const loaded = await vite.loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile, root, 'silent');
    const base = loaded?.config || {};
    const aliases = base.test?.alias;
    const server = await vite.createServer({ ...base, root, configFile: false, logLevel: 'silent', server: { ...base.server, middlewareMode: true, watch: null }, resolve: { ...base.resolve, alias: aliases ? [...Object.entries(aliases).map(([find, replacement]) => ({find, replacement})), ...(Array.isArray(base.resolve?.alias) ? base.resolve.alias : Object.entries(base.resolve?.alias || {}).map(([find, replacement]) => ({ find, replacement })))] : base.resolve?.alias } });
    try { resolved = (await server.pluginContainer.resolveId(specifier, path.resolve(root, file)))?.id?.split('?')[0]; }
    finally { await server.close(); }
  }
  if (resolved && path.isAbsolute(resolved) && !resolved.includes(`${path.sep}node_modules${path.sep}`) && resolved.startsWith(root + path.sep)) process.stdout.write(JSON.stringify({ file: resolved }));
  else process.stdout.write('{}');
} catch { process.stdout.write('{}'); }
