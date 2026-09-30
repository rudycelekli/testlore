import test from 'node:test';
import assert from 'node:assert/strict';
import { totalLabel } from '../src/checkout.js';
test('checkout formats cents', () => assert.equal(totalLabel(1099), '$10.99'));
test('checkout rejects negative cents', () => assert.throws(() => totalLabel(-1), RangeError));
