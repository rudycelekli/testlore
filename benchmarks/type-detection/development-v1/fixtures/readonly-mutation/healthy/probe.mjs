import assert from 'node:assert/strict';
import {update} from './module.ts';
const entry = {id: 1};
assert.equal(update(entry, false), 1);
assert.deepEqual(entry, {id: 1});
console.log('ordinary-input assertions passed');
