import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
export const TEST = /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__)\/.*\.[cm]?[jt]sx?$/;
const EXCLUDED = new Set(['.git', 'node_modules', '.tddswarm', '.firecrawl', 'coverage', 'dist', 'build', '.next']);
export const normalize = p => p.split(path.sep).join('/').replace(/^\.\//, '');
export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function safePath(root, file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error(`Unsafe project path: ${file}`);
  const target = path.resolve(root, file);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes project: ${file}`);
  let cursor = target;
  while (cursor !== path.resolve(root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink path is unsupported: ${file}`);
    cursor = path.dirname(cursor);
  }
  return target;
}
export function listFiles(root) {
  let files;
  try {
    // Work only in this project, including when it is a subdirectory of a larger repo.
    files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.']).split('\0').filter(Boolean);
  } catch {
    files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(normalize(path.relative(root, full)));
      }
    }
    walk(root);
  }
  return [...new Set(files.map(normalize))].filter(f => !f.split('/').some(s => EXCLUDED.has(s))).filter(f => {
    try { return fs.statSync(safePath(root, f)).isFile(); } catch { return false; }
  }).sort();
}
export function readConfig(root) {
  const file = path.join(root, 'tddswarm.config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const key of ['runner', 'agent']) {
    if (config[key] && (!Array.isArray(config[key]) || !config[key].length || config[key].some(v => typeof v !== 'string' || !v))) throw new Error(`${key} must be a nonempty array of executable and arguments`);
  }
  if (config.runner && config.runner.filter(v => v === '{files}').length !== 1) throw new Error('runner must contain exactly one standalone {files} argument');
  if (config.ignoreChanges && (!Array.isArray(config.ignoreChanges) || config.ignoreChanges.some(v => typeof v !== 'string'))) throw new Error('ignoreChanges must be an array of exact project paths');
  if (config.alwaysRun && (!Array.isArray(config.alwaysRun) || config.alwaysRun.some(v => typeof v !== 'string'))) throw new Error('alwaysRun must be an array of test paths');
  if (config.dependencies && (typeof config.dependencies !== 'object' || Array.isArray(config.dependencies) || Object.values(config.dependencies).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')))) throw new Error('dependencies must map test paths to arrays of project paths');
  if (config.fullRunEvery !== undefined && (!Number.isInteger(config.fullRunEvery) || config.fullRunEvery < 1)) throw new Error('fullRunEvery must be a positive integer');
  return config;
}
