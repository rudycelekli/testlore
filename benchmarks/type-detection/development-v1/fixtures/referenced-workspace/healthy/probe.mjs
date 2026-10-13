import assert from 'node:assert/strict';
import {next} from './packages/app/module.ts';
assert.deepEqual(next('idle'), {value: 0});
console.log('ordinary-input assertions passed');
