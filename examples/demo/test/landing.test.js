import test from 'node:test';
import assert from 'node:assert/strict';
import { heading } from '../src/landing.js';
import copy from '../src/copy.json' with { type: 'json' };
test('heading presents trimmed copy', () => assert.equal(heading({ headline: '  Build with confidence.  ' }), 'Build with confidence.'));

test('published heading matches the copy contract', () => assert.equal(heading(copy), 'Build with confidence.'));
