import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolvePluginConfig } from './plugin-config.js';
import { validateConfigurationInputs } from './configuration-inputs.js';

export const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
export const TEST = /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__)\/.*\.[cm]?[jt]sx?$/;
const EXCLUDED = new Set(['.git', 'node_modules', '.tddswarm', '.firecrawl', 'coverage', 'dist', 'build', '.next']);
export const normalize = p => p.split(path.sep).join('/').replace(/^\.\//, '');
export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
// One process binds the immutable commit and project prefix. It is read anew
// for every planning phase; neither refs nor working-tree state are cached.
export function gitBaseline(root, base = 'HEAD') {
  const value = git(root, ['rev-parse', '--show-prefix', '--verify', `${base}^{commit}`]);
  const match = /\n([a-f0-9]{40}|[a-f0-9]{64})\n?$/.exec(value);
  if (!match) throw new Error('Invalid Git baseline response');
  return {baseSha: match[1], prefix: value.slice(0, match.index)};
}
export function gitSources(root, baseSha, prefix, files) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseSha) || typeof prefix !== 'string' || prefix.includes('\0')) throw new Error('Invalid immutable Git source scope');
  files.forEach(file=>safePath(root,file));
  const individually = () => {
    const sources=[];let total=0;
    for(const file of files){let text;try{text=git(root,['show',`${baseSha}:${prefix}${file}`]);}catch(error){if(error.code==='ENOBUFS'||error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw error;continue;}
      total+=Buffer.byteLength(text);if(total>32*1024*1024)throw new Error('Git source response budget exceeded');sources.push([file,text]);}
    return sources;
  };
  if (files.length < 3) return individually();
  if (files.length > 10000) throw new Error('Git source request budget exceeded');
  const requests=files.map(file=>`${baseSha}:${prefix}${file}`);
  const input=Buffer.from(requests.join('\0')+'\0');
  if(input.length>2*1024*1024)throw new Error('Git source input budget exceeded');
  let bytes;
  try {
    bytes=execFileSync('git',['-C',root,'cat-file','--batch','-z'],{input,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
  } catch(error) {if(error.code==='ENOBUFS'||error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw error;return individually();} // Older Git retains the existing fresh show path.
  const result=[];let cursor=0;
  for(let index=0;index<requests.length;index++) {
    const missing=Buffer.from(requests[index]+' missing\n');
    if(bytes.subarray(cursor,cursor+missing.length).equals(missing)){cursor+=missing.length;continue;}
    const end=bytes.indexOf(10,cursor);
    if(end<0)throw new Error('Incomplete Git source batch header');
    const match=/^(?:[a-f0-9]{40}|[a-f0-9]{64}) blob (\d+)$/.exec(bytes.subarray(cursor,end).toString());
    if(!match)throw new Error('Invalid Git source batch object');
    const size=Number(match[1]),start=end+1,next=start+size;
    if(!Number.isSafeInteger(size)||next>=bytes.length||bytes[next]!==10)throw new Error('Incomplete Git source batch body');
    result.push([files[index],bytes.subarray(start,next).toString('utf8')]);cursor=next+1;
  }
  if(cursor!==bytes.length)throw new Error('Unexpected Git source batch suffix');
  return result;
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
  const file = safePath(root, 'tddswarm.config.json');
  return validateConfig(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
}
export function validateConfig(raw) {
  const config = resolvePluginConfig(raw);
  validateConfigurationInputs(config.configurationInputs);
  if(config.executionMode !== undefined && !['shadow','selective'].includes(config.executionMode))throw new Error('executionMode must be shadow or selective');
  if(config.analysisCache!==undefined){
    const cache=config.analysisCache;
    if(!cache || typeof cache!=='object' || Array.isArray(cache) || Object.keys(cache).some(k=>!['enabled','maxEntries','maxBytes'].includes(k)))throw new Error('analysisCache must contain only enabled, maxEntries, maxBytes');
    if(cache.enabled!==undefined&&typeof cache.enabled!=='boolean')throw new Error('analysisCache.enabled must be boolean');
    if(cache.maxEntries!==undefined&&(!Number.isInteger(cache.maxEntries)||cache.maxEntries<1||cache.maxEntries>10000))throw new Error('analysisCache.maxEntries must be 1–10000');
    if(cache.maxBytes!==undefined&&(!Number.isInteger(cache.maxBytes)||cache.maxBytes<4096||cache.maxBytes>67108864))throw new Error('analysisCache.maxBytes must be 4096–67108864');
  }
  for (const key of ['runner', 'agent']) {
    if (config[key] && (!Array.isArray(config[key]) || !config[key].length || config[key].some(v => typeof v !== 'string' || !v))) throw new Error(`${key} must be a nonempty array of executable and arguments`);
  }
  if (config.runner && config.runner.filter(v => v === '{files}').length !== 1) throw new Error('runner must contain exactly one standalone {files} argument');
  if (config.ignoreChanges && (!Array.isArray(config.ignoreChanges) || config.ignoreChanges.some(v => typeof v !== 'string'))) throw new Error('ignoreChanges must be an array of exact project paths');
  if (config.alwaysRun && (!Array.isArray(config.alwaysRun) || config.alwaysRun.some(v => typeof v !== 'string'))) throw new Error('alwaysRun must be an array of test paths');
  if (config.dependencies && (typeof config.dependencies !== 'object' || Array.isArray(config.dependencies) || Object.values(config.dependencies).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')))) throw new Error('dependencies must map test paths to arrays of project paths');
  if (config.fullRunEvery !== undefined && (!Number.isInteger(config.fullRunEvery) || config.fullRunEvery < 1)) throw new Error('fullRunEvery must be a positive integer');
  for (const key of ['testMatch', 'testExclude']) if (config[key] && (!Array.isArray(config[key]) || config[key].some(p => typeof p !== 'string'))) throw new Error(`${key} must be an array of glob patterns`);
  if (config.discovery && !['static','native'].includes(config.discovery) && (!Array.isArray(config.discovery) || !config.discovery.length || config.discovery.some(v=>typeof v!=='string'))) throw new Error('discovery must be static, native, or an argv array');
  for (const key of ['environment','env']) if (config[key] && (typeof config[key] !== 'object' || Array.isArray(config[key]) || Object.values(config[key]).some(v => typeof v !== 'string'))) throw new Error(`${key} must map names to strings`);
  if(config.browser?.closedWorld!==undefined&&typeof config.browser.closedWorld!=='boolean')throw new Error('browser.closedWorld must be boolean');
  for (const key of ['runtime','browser','contracts','services','integration']) if (config[key] && (typeof config[key] !== 'object' || Array.isArray(config[key]))) throw new Error(`${key} must be an object`);
  return config;
}
