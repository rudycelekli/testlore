import assert from 'node:assert/strict';
import {label} from './module.ts';
assert.equal(label('hello'), 'HELLO');
console.log('ordinary-input assertions passed');
