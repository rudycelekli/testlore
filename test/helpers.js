import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tddswarm-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) write(root, file, content);
  return root;
}
export function write(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
}
export function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
export function commit(root) {
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'TDDSwarm Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'baseline');
}
export const twoModules = {
  'package.json': { type: 'module' },
  '.gitignore': '.tddswarm/\n',
  'src/a.js': 'export const a = 1;',
  'src/b.js': 'export const b = 2;',
  'test/a.test.js': "import {a} from '../src/a.js'; import test from 'node:test'; import assert from 'node:assert/strict'; test('a', () => assert.equal(a,1));",
  'test/b.test.js': "import {b} from '../src/b.js'; import test from 'node:test'; import assert from 'node:assert/strict'; test('b', () => assert.equal(b,2));"
};
