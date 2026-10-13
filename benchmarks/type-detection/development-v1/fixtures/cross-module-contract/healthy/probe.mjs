import assert from 'node:assert/strict';
import {entry} from './packages/app/module.ts';
assert.equal(entry().id, 'fixed');
console.log('ordinary-input assertions passed');
