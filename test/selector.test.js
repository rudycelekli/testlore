import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plan, buildGraph, evidencePath } from '../src/index.js';
import { analyze } from '../src/graph.js';
import { fixture, write, commit, git, twoModules } from './helpers.js';

test('one-module changes select only the transitive dependent and explain the chain', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "import { value } from './shared.js'; export const a = value;", 'src/shared.js': 'export const value=1;' });
  const result = plan(root, { changed: ['src/shared.js'] });
  assert.equal(result.mode, 'affected');
  assert.deepEqual(result.selected, ['test/a.test.js']);
  assert.deepEqual(result.decisions[0].paths, [['test/a.test.js', 'src/a.js', 'src/shared.js']]);
});
test('shared dependency changes select both dependents', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "export { x as a } from './shared.js';", 'src/b.js': "export { x as b } from './shared.js';", 'src/shared.js': 'export const x=1;' });
  assert.equal(plan(root, { changed: ['src/shared.js'] }).selected.length, 2);
});
test('explicit asset dependencies select just the consuming test', t => {
  const root = fixture(t, { ...twoModules, 'public/copy.json': '{}', 'tddswarm.config.json': { dependencies: { 'test/a.test.js': ['public/copy.json'] } } });
  assert.deepEqual(plan(root, { changed: ['public/copy.json'] }).selected, ['test/a.test.js']);
});
test('unmapped assets, new files, and nonexistent paths widen to all tests', t => {
  const root = fixture(t, twoModules);
  for (const changed of ['public/app.css', 'src/new.js', 'not-present']) {
    const result = plan(root, { changed: [changed] });
    assert.equal(result.mode, 'full'); assert.equal(result.selected.length, 2);
  }
});
test('configuration and lockfile changes force a full run', t => {
  const root = fixture(t, twoModules);
  for (const changed of ['package.json', 'pnpm-lock.yaml', 'jest.config.ts', '.env.local', 'test/setup.ts']) assert.equal(plan(root, { changed: [changed] }).mode, 'full');
});
test('computed import and runtime filesystem access invalidate selective evidence', t => {
  for (const code of ["const name='x'; import(name);", "require(process.env.MODULE);", "import {readFileSync} from 'node:fs';", "const x = import.meta.glob('./*.js');"]) {
    const root = fixture(t, { ...twoModules, 'src/dynamic.js': code });
    assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
  }
});
test('malformed source and unresolved relative imports force full runs', t => {
  for (const code of ['const x = ;', "import './missing.js';"]) {
    const root = fixture(t, { ...twoModules, 'src/a.js': code });
    assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
  }
});
test('literal dynamic imports are traced and comments cannot forge an edge', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "// import './b.js'\nexport async function f(){return import('./shared.js')}\n", 'src/shared.js': 'export const value=1;' });
  assert.deepEqual(buildGraph(root).edges['src/a.js'], ['src/shared.js']);
});
test('TypeScript emitted JS specifiers resolve to source TS and re-exports are traced', t => {
  const root = fixture(t, { 'src/a.ts': "export { x } from './b.js';", 'src/b.ts': 'export const x:number=1;', 'test/a.test.ts': "import {x} from '../src/a.js';" });
  assert.deepEqual(evidencePath(buildGraph(root), 'test/a.test.ts', 'src/b.ts'), ['test/a.test.ts', 'src/a.ts', 'src/b.ts']);
});
test('aliases and package/workspace resolution widen until supported', t => {
  const root = fixture(t, { ...twoModules, 'tsconfig.json': { compilerOptions: { paths: { '@app/*': ['src/*'] } } } });
  assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
  write(root, 'tsconfig.json', {});
  write(root, 'package.json', { type: 'module', workspaces: ['packages/*'] });
  assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
});
test('circular dependencies terminate with a valid shortest path', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "import './b.js';", 'src/b.js': "import './a.js';" });
  assert.equal(plan(root, { changed: ['src/a.js'] }).selected.length, 2);
});
test('git compares committed, staged, unstaged, and untracked changes to a base', t => {
  const root = fixture(t, twoModules); commit(root);
  const base = git(root, 'rev-parse', 'HEAD').trim();
  write(root, 'src/a.js', 'export const a=3;'); git(root, 'add', '.'); git(root, 'commit', '-m', 'change');
  write(root, 'src/b.js', 'export const b=4;');
  write(root, 'src/new.js', 'export const newValue=1;');
  assert.deepEqual(plan(root, { base }).changed, ['src/a.js', 'src/b.js', 'src/new.js']);
});
test('removed imports retain baseline dependencies during selection', t => {
  const root = fixture(t, { ...twoModules, 'src/a.js': "import { b } from './b.js'; export const a=b;" }); commit(root);
  write(root, 'src/a.js', 'export const a=1;');
  write(root, 'src/b.js', 'export const b=3;');
  const result = plan(root);
  assert.ok(result.decisions.find(d => d.test === 'test/a.test.js').paths.some(p => p.includes('src/b.js')));
});
test('deleted source files do not disappear silently from the plan', t => {
  const root = fixture(t, twoModules); commit(root);
  fs.unlinkSync(path.join(root, 'src/a.js'));
  assert.equal(plan(root).mode, 'full');
});
test('renamed files and new tests are included through Git change discovery', t => {
  const root = fixture(t, twoModules); commit(root);
  fs.renameSync(path.join(root, 'src/a.js'), path.join(root, 'src/renamed.js'));
  write(root, 'test/new.test.js', "import '../src/renamed.js';");
  const result = plan(root);
  assert.ok(result.changed.includes('src/a.js')); assert.ok(result.changed.includes('src/renamed.js')); assert.ok(result.selected.includes('test/new.test.js'));
});
test('subdirectory projects use Git paths relative to their own root', t => {
  const root = fixture(t, Object.fromEntries(Object.entries(twoModules).map(([k,v]) => [`project/${k}`,v]))); commit(root);
  write(root, 'project/src/a.js', 'export const a=3;');
  assert.deepEqual(plan(path.join(root, 'project')).selected, ['test/a.test.js']);
});
test('missing Git baseline fails open', t => {
  const root = fixture(t, twoModules);
  assert.equal(plan(root).mode, 'full');
});
test('exact ignore policy is explicit and known dependency overrides it', t => {
  const root = fixture(t, { ...twoModules, 'README.md': 'docs', 'tddswarm.config.json': { ignoreChanges: ['README.md', 'src/a.js'] } });
  assert.equal(plan(root, { changed: ['README.md'] }).selected.length, 0);
  assert.deepEqual(plan(root, { changed: ['src/a.js'] }).selected, ['test/a.test.js']);
});
test('no-local-dependency tests are retained for code changes', t => {
  const root = fixture(t, { ...twoModules, 'test/browser.test.js': "import test from 'node:test'; test('browser',()=>{});" });
  assert.ok(plan(root, { changed: ['src/a.js'] }).selected.includes('test/browser.test.js'));
});
test('always-run policy, failed history, and periodic full runs are respected', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { alwaysRun: ['test/b.test.js'], fullRunEvery: 3 } });
  assert.ok(plan(root, { changed: ['src/a.js'] }).selected.includes('test/b.test.js'));
  write(root, '.tddswarm/history.json', { count: 2, failed: ['test/a.test.js'] });
  assert.ok(plan(root, { changed: [] }).reasons.includes('periodic-full-run'));
});
test('failed tests are retried even with no new changes', t => {
  const root = fixture(t, twoModules);
  write(root, '.tddswarm/history.json', { count: 1, failed: ['test/b.test.js'] });
  assert.deepEqual(plan(root, { changed: [] }).selected, ['test/b.test.js']);
});
test('invalid dependency declarations are rejected and missing declarations widen', t => {
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': { dependencies: { 'test/a.test.js': 'src/a.js' } } });
  assert.throws(() => plan(root, { changed: ['src/a.js'] }), /dependencies/);
  write(root, 'tddswarm.config.json', { dependencies: { 'test/a.test.js': ['missing.json'] } });
  assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
});
test('symlinks cannot bring outside project source into analysis', t => {
  const root = fixture(t, twoModules);
  fs.symlinkSync(path.join(root, 'src/a.js'), path.join(root, 'src/alias.js'));
  assert.equal(buildGraph(root).files.includes('src/alias.js'), false);
});
test('unsupported AST dynamic mechanisms are reported', () => {
  for (const source of ["new Function('return 1')", "require.resolve(process.env.X)", "module.register('x')"]) assert.ok(analyze('a.js', source).warnings.length);
});
