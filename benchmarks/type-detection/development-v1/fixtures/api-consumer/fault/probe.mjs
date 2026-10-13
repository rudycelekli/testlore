import assert from 'node:assert/strict';
import {configuredCount} from './consumer.ts';
assert.equal(configuredCount(), 12);
console.log('ordinary-input assertions passed');
