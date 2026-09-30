import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { root, adapter, command, imports } = request;
const requireProject = createRequire(path.join(root, 'package.json'));
function loadPath(name) {
  try { return requireProject.resolve(name); } catch {}
  for (const argument of command) if (path.isAbsolute(argument) && fs.existsSync(argument)) {
    try { return createRequire(argument).resolve(name); } catch {}
  }
  throw new Error(`Install ${name} locally or specify its absolute runner CLI`);
}
function argument(name, short) {
  for (let i = 0; i < command.length; i++) {
    if (command[i] === name || command[i] === short) return command[i + 1];
    if (command[i].startsWith(name + '=') || short && command[i].startsWith(short + '=')) return command[i].slice(command[i].indexOf('=') + 1);
  }
}
function resolution(paths) {
  const found = [...new Set(paths.filter(Boolean))];
  const local = found.filter(file => path.isAbsolute(file) && !file.includes(`${path.sep}node_modules${path.sep}`) && file.startsWith(root + path.sep));
  return { paths: local, external: found.length > 0 && local.length === 0, unresolved: found.length === 0 };
}
const output = { resolutions: [], configFiles: [], complete: true };
try {
  if (adapter === 'jest') {
    const result = spawnSync(command[0], [...command.slice(1), '--showConfig'], { cwd: root, encoding: 'utf8', env: process.env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Jest config resolution failed');
    const configs = JSON.parse(result.stdout).configs;
    const module = await import(pathToFileURL(loadPath('jest-resolve')).href);
    const Resolver = module.default.default || module.default;
    for (const { file, specifier } of imports) {
      const absolute = path.resolve(root, file);
      const matching = configs.length === 1 ? configs : configs.filter(c => (c.roots || [c.rootDir]).some(r => absolute.startsWith(r + path.sep)));
      if (matching.length !== 1) { output.resolutions.push({ paths: [], unresolved: true }); continue; }
      const config = matching[0];
      let names = [specifier];
      for (const [pattern, replacements] of config.moduleNameMapper || []) {
        const regex = new RegExp(pattern);
        if (regex.test(specifier)) { names = (Array.isArray(replacements) ? replacements : [replacements]).map(r => specifier.replace(regex, r)); break; }
      }
      const configuredConditions = config.testEnvironmentOptions?.customExportConditions;
      const environmentConditions = configuredConditions || (config.testEnvironment.includes('jest-environment-node') ? ['node', 'node-addons'] : config.testEnvironment.includes('jest-environment-jsdom') ? ['browser'] : null);
      if (!environmentConditions) { output.resolutions.push({ paths: [], unresolved: true }); output.complete = false; continue; }
      const resolved = [];
      for (const name of names) for (const kind of ['require', 'import']) {
        resolved.push(Resolver.findNodeModule(name, { basedir: path.dirname(absolute), extensions: config.moduleFileExtensions.map(x => '.' + x), moduleDirectory: config.moduleDirectories, paths: config.modulePaths, resolver: config.resolver, rootDir: config.rootDir, conditions: [kind, 'default', ...environmentConditions] }));
      }
      output.resolutions.push(resolution(resolved));
    }
  } else {
    // Match Vitest's config-loading environment, including CLI-supplied mode.
    process.env.VITEST = 'true'; process.env.NODE_ENV ??= 'test';
    const unsupported = command.some(arg => /^(?:--(?:workspace|project|browser|root|configLoader|environment)|-r)(?:=|$)/.test(arg));
    if (unsupported) throw new Error('Unsupported native resolution context; use a full suite');
    const vite = await import(pathToFileURL(loadPath('vite')).href);
    let configFile = argument('--config', '-c');
    if (configFile) configFile = path.resolve(root, configFile);
    configFile ||= ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs', 'vitest.config.cts', 'vitest.config.cjs'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
    const mode = argument('--mode') || 'test';
    const loaded = await vite.loadConfigFromFile({ command: 'serve', mode, isSsrBuild: false, isPreview: false }, configFile, root, 'silent');
    const base = loaded?.config || {};
    if (base.test?.projects?.length || base.test?.browser?.enabled || base.test?.workspace || base.root && path.resolve(root,base.root)!==root || base.test?.environment && base.test.environment!=='node') throw new Error('Multiple projects/browser resolution requires a native project graph');
    output.configFiles.push(...(loaded?.dependencies || []), ...(loaded?.path ? [loaded.path] : []));
    const aliases = value => Array.isArray(value) ? value : Object.entries(value || {}).map(([find, replacement]) => ({ find, replacement }));
    const server = await vite.createServer({ ...base, root, mode, configFile: false, logLevel: 'silent', server: { ...base.server, middlewareMode: true, watch: null }, resolve: { ...base.resolve, alias: [...aliases(base.test?.alias), ...aliases(base.resolve?.alias)] } });
    try {
      for (const { file, specifier } of imports) {
        const resolved = [];
        // Preserve both client and SSR possibilities instead of guessing package conditions.
        for (const ssr of [false, true]) {
          const container = ssr && server.environments?.ssr?.pluginContainer || server.pluginContainer;
          resolved.push((await container.resolveId(specifier, path.resolve(root, file), { ssr }))?.id?.split('?')[0]);
        }
        output.resolutions.push(resolution(resolved));
      }
    } finally { await server.close(); }
  }
} catch (error) {
  output.complete = false; output.error = error.message;
  output.resolutions = imports.map(() => ({ paths: [], unresolved: true }));
}
process.stdout.write(JSON.stringify(output));
