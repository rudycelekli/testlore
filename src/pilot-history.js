import fs from 'node:fs';
import path from 'node:path';
import { git, safePath } from './files.js';
import { digest } from './provenance.js';

// Exact tree identities include additions/deletions and nested workspace manifests.
const dependencyInput = /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json|\.nvmrc|\.node-version|\.tool-versions|\.npmrc)$/;
function dependencyTree(root, revision) {
  return git(root, ['ls-tree', '-r', '-z', revision]).split('\0').filter(Boolean).filter(line => dependencyInput.test(line.slice(line.indexOf('\t') + 1))).sort();
}
export function installedDependencyLinks(root) {
  const directory = path.join(root, 'node_modules');
  if (!fs.existsSync(directory)) return [];
  const links = [];
  for (const name of fs.readdirSync(directory)) {
    const location = path.join(directory, name);
    const entries = name.startsWith('@') && fs.statSync(location).isDirectory() ? fs.readdirSync(location).map(child => path.join(location, child)) : [location];
    for (const entry of entries) if (fs.lstatSync(entry).isSymbolicLink()) {
      const target = fs.realpathSync(entry);
      if (!target.startsWith(directory + path.sep)) links.push({ file:path.relative(directory,entry), target, local:target.startsWith(root + path.sep) });
    }
  }
  return links;
}
export function linkInstalledDependencies(source, workspace) {
  const installed = path.join(source,'node_modules');
  if (!fs.existsSync(installed)) return {mode:'none',isolatedWorkspaceLinks:0};
  const links = installedDependencyLinks(source), local = links.filter(link=>link.local);
  const destination = path.join(workspace,'node_modules');
  if (!local.length) fs.symlinkSync(installed,destination,'dir');
  else {
    fs.mkdirSync(destination);
    const linkEntry = (relative) => {
      const original=path.join(installed,relative), found=local.find(link=>link.file===relative);
      const target=found?path.join(workspace,path.relative(source,found.target)):original;
      fs.symlinkSync(target,path.join(destination,relative),fs.statSync(original).isDirectory()?'dir':'file');
    };
    for (const name of fs.readdirSync(installed)) {
      if (name.startsWith('@') && local.some(link=>link.file.startsWith(name+path.sep))) {
        fs.mkdirSync(path.join(destination,name));
        for (const child of fs.readdirSync(path.join(installed,name))) linkEntry(path.join(name,child));
      } else linkEntry(name);
    }
  }
  return {mode:'shared-installed-local',isolatedWorkspaceLinks:local.length};
}
export function inspectHistoricalChange(root, change, installedRevision) {
  for (const revision of [change.baseRevision, change.headRevision]) {
    if (git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).trim() !== revision) throw new Error('Historical revisions must identify exact commit objects');
  }
  git(root, ['merge-base', '--is-ancestor', change.baseRevision, change.headRevision]);
  const tokens = git(root, ['diff', '--name-status', '--find-renames', '-z', change.baseRevision, change.headRevision, '--', '.']).split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++], files = [tokens[i++]];
    if (/^[RC]/.test(status)) files.push(tokens[i++]);
    for (const file of files) {
      if (!file) throw new Error('Incomplete historical diff');
      safePath(root, file);
      if (file.split('/').some(part => ['.tddswarm', 'node_modules', '.git'].includes(part)) || file === 'tddswarm.config.json') throw new Error('Historical replay cannot alter pilot metadata, dependencies or analysis configuration');
    }
    entries.push({ status, files });
  }
  if (!entries.length || entries.length > 500) throw new Error('Historical replay needs 1–500 changed paths');
  const dependencies = dependencyTree(root, installedRevision);
  const links=installedDependencyLinks(root), external=links.some(link=>!link.local);
  const compatible = !external && [change.baseRevision, change.headRevision].every(revision => JSON.stringify(dependencyTree(root, revision)) === JSON.stringify(dependencies));
  return { baseRevision: change.baseRevision, headRevision: change.headRevision, entries, dependencyFingerprint: digest(dependencies), dependencyCompatible: compatible, isolatedWorkspaceLinks:links.filter(link=>link.local).length, rejection: compatible ? null : external?'historical-external-local-dependency-link':'historical-dependency-or-runtime-drift' };
}
