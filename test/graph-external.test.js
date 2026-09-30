import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, write, twoModules } from './helpers.js';
import { buildGraph, addSource } from '../src/graph.js';
import { plan } from '../src/selector.js';
import { execute } from '../src/execution.js';

test('a runtime external package with conditional declaration exports permits native Node affected routing', t => {
  const config = { adapter: 'node', discovery: 'native', runner: [process.execPath, '--test', '{files}'] };
  const root = fixture(t, { ...twoModules, 'tddswarm.config.json': config,
    'test/a.test.js': "import {check} from 'typed-library'; import {a} from '../src/a.js'; import test from 'node:test'; import assert from 'node:assert/strict'; test('a property',()=>check(()=>assert.equal(a,1)));",
    'node_modules/typed-library/package.json': { name: 'typed-library', version: '1.0.0', type: 'module', exports: { '.': { import: { types: './index.d.ts', default: './index.js' } } } },
    'node_modules/typed-library/index.d.ts': 'export declare function check(assertion:()=>void):void;',
    'node_modules/typed-library/index.js': 'export const check=assertion=>assertion();'
  });
  const full = execute(root, ['test/a.test.js', 'test/b.test.js'], config, { capture: true });
  assert.equal(full.complete, true); assert.equal(full.exitCode, 0);
  write(root, 'src/a.js', 'export const a=99;');
  const selection = plan(root, { changed: ['src/a.js'] });
  assert.equal(selection.mode, 'affected'); assert.deepEqual(selection.selected, ['test/a.test.js']);
  assert.equal(selection.warnings.some(warning => warning.reason === 'unresolved-import:typed-library'), false);
  const selected = execute(root, selection.selected, config, { capture: true });
  const groundTruth = execute(root, ['test/a.test.js', 'test/b.test.js'], config, { capture: true });
  assert.equal(selected.complete, true); assert.equal(selected.exitCode, 1);
  assert.deepEqual(selected.tests.filter(item => item.status === 'failed').map(item => item.id), groundTruth.tests.filter(item => item.status === 'failed').map(item => item.id));
  for (const changed of ['package.json', 'package-lock.json', 'unknown.json']) assert.equal(plan(root, { changed: [changed] }).mode, 'full');
});
test('internal package declaration exports and configured aliases retain conservative runtime uncertainty', t => {
  const root = fixture(t, { ...twoModules,
    'package.json': { name: 'own-package', type: 'module', exports: { '.': { types: './types/index.d.ts', default: './src/a.js' } } },
    'types/index.d.ts': 'export declare const a:number;',
    'test/a.test.js': "import {a} from 'own-package';"
  });
  assert.ok(buildGraph(root).warnings.some(warning => warning.reason === 'unresolved-import:own-package'));
  assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
  write(root, 'tsconfig.json', { compilerOptions: { baseUrl: '.', paths: { 'typed-library': ['node_modules/typed-library/index.d.ts'] } } });
  write(root, 'node_modules/typed-library/package.json', { name: 'typed-library', version: '1.0.0', types: './index.d.ts' });
  write(root, 'node_modules/typed-library/index.d.ts', 'export declare const a:number;');
  write(root, 'test/a.test.js', "import {a} from 'typed-library';");
  assert.ok(buildGraph(root).warnings.some(warning => warning.reason === 'unresolved-import:typed-library'));
  assert.equal(plan(root, { changed: ['src/a.js'] }).mode, 'full');
  write(root, 'test/a.test.js', "import {a} from '@/missing.js';");
  assert.ok(buildGraph(root).warnings.some(warning => warning.reason === 'unresolved-import:@/missing.js'));
});
test('external typings cannot override native unresolved or declaration-only local resolution', t => {
  const root = fixture(t, { ...twoModules,
    'node_modules/typed-library/package.json': { name: 'typed-library', version: '1.0.0', types: './index.d.ts' },
    'node_modules/typed-library/index.d.ts': 'export declare const a:number;',
    'types/alias.d.ts': 'export declare const a:number;'
  });
  for (const native of [{ paths: [], unresolved: true }, { paths: ['types/alias.d.ts'], external: false, unresolved: false }]) {
    const graph = buildGraph(root);
    graph.nativeResolutions = new Map([[JSON.stringify(['test/native.test.js', 'typed-library']), native]]);
    addSource(graph, 'test/native.test.js', "import {a} from 'typed-library';");
    assert.ok(graph.warnings.some(warning => warning.file === 'test/native.test.js' && warning.reason === 'unresolved-import:typed-library'));
  }
});
