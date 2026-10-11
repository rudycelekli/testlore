import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { daemonFullSuiteObservation, fullSuiteGroupObservation, preservesFullSuiteGroups, cliEphemeralPidObservation, preservesCliFullSuiteObservations } from '../../scripts/openrig-defect-pilot.js';

const corpus = path.dirname(fileURLToPath(import.meta.url));
const daemonProfile = JSON.parse(fs.readFileSync(path.join(corpus, 'daemon-full-suite-groups.json')));
const pidProfile = JSON.parse(fs.readFileSync(path.join(corpus, 'cli-ephemeral-pid-profile.json')));
const upstream = '/declared/openrig';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const native = files => ({ success: true, numFailedTests: 0, numFailedTestSuites: 0, numTotalTests: files.reduce((n, file) => n + file.assertionResults.length, 0), numPassedTests: files.reduce((n, file) => n + file.assertionResults.filter(item => item.status === 'passed').length, 0), testResults: files });
const recount = raw => Object.assign(raw, native(raw.testResults));

// Synthetic evaluator controls, never claimed as independent upstream execution.
function daemonRaw() {
  const files = new Map();
  for (const group of daemonProfile.groups) {
    const raw = group.rawIdentity; const name = path.join(upstream, raw[0]);
    if (!files.has(name)) files.set(name, { name, status: 'passed', assertionResults: [] });
    files.get(name).assertionResults.push(...Array.from({ length: group.statuses.passed }, () => ({ ancestorTitles: raw[1], title: raw[2], fullName: raw[3], status: 'passed' })));
  }
  return native([...files.values()]);
}

test('binds exactly fifteen daemon raw groups and all eleven original source/fixture pins', () => {
  const raw = daemonRaw(); const sources = daemonProfile.sources;
  const observation = daemonFullSuiteObservation(raw, upstream, sources);
  assert.equal(observation.duplicates.length, 15); assert.equal(observation.total, 45);
  assert.equal(observation.omissionAuthority, false); assert.equal(observation.individualIdentitiesQualified, false);
  for (const [relative, digest] of Object.entries(sources)) {
    const file = path.join(corpus, 'fixtures/daemon-group-sources', relative);
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : gunzipSync(fs.readFileSync(file + '.gz'), { maxOutputLength: 64 * 1024 });
    assert.equal(sha(bytes), digest);
    assert.throws(() => daemonFullSuiteObservation(raw, upstream, { ...sources, [relative]: 'f'.repeat(64) }));
  }
  for (const group of daemonProfile.groups) {
    for (const change of [
      file => { file.assertionResults[0].title += ' drift'; },
      file => { file.assertionResults[0].fullName += ' drift'; },
      file => { file.assertionResults[0].ancestorTitles = ['unknown']; },
      file => { file.assertionResults[0].location = { line: 1, column: 1 }; },
      file => { file.assertionResults[0].status = 'pending'; },
      file => { file.assertionResults.splice(0, 1); },
    ]) {
      const changed = structuredClone(raw);
      const file = changed.testResults.find(item => item.name === path.join(upstream, group.rawIdentity[0]));
      // Target the precise repeated title even when one file contains several groups.
      const index = file.assertionResults.findIndex(item => item.title === group.rawIdentity[2] && JSON.stringify(item.ancestorTitles) === JSON.stringify(group.rawIdentity[1]));
      [file.assertionResults[0], file.assertionResults[index]] = [file.assertionResults[index], file.assertionResults[0]];
      change(file); recount(changed); assert.throws(() => daemonFullSuiteObservation(changed, upstream, sources));
    }
  }
  const unknown = structuredClone(raw);
  unknown.testResults[0].assertionResults.push(...Array.from({ length: 2 }, () => ({ ancestorTitles: [], title: 'unknown duplicate', fullName: 'unknown duplicate', status: 'passed' })));
  recount(unknown); assert.throws(() => daemonFullSuiteObservation(unknown, upstream, sources));
  const extra = structuredClone(raw);
  extra.testResults[0].assertionResults.push({ ancestorTitles: [], title: 'unknown unique extra', fullName: 'unknown unique extra', status: 'passed' }); recount(extra);
  assert.throws(() => preservesFullSuiteGroups(observation, daemonFullSuiteObservation(extra, upstream, sources)));
});

function cliRaw(pid) {
  const rows = pidProfile.expectedRows.map(row => Object.fromEntries(row.keys.map(key => [key, key === 'pid' ? pid : row[key]])));
  const staticSuffixes = pidProfile.staticRawSuffixes;
  return native([{ name: path.join(upstream, pidProfile.sourcePath), status: 'passed', assertionResults: [...staticSuffixes, ...rows.map(input => JSON.stringify(input))].map(suffix => ({ ancestorTitles: pidProfile.ancestorTitles, title: pidProfile.rawTitlePrefix + suffix, fullName: pidProfile.rawFullNamePrefix + suffix, status: 'passed' })) }]);
}
const spell = (assertion, input) => { assertion.title = pidProfile.rawTitlePrefix + JSON.stringify(input); assertion.fullName = pidProfile.rawFullNamePrefix + JSON.stringify(input); };

test('retains five distinct raw CLI PID inputs with no equivalence or individual routing authority', () => {
  const original = cliRaw(101), fixed = cliRaw(202);
  const before = fullSuiteGroupObservation(original), after = fullSuiteGroupObservation(fixed);
  const result = preservesCliFullSuiteObservations(before, after, upstream, pidProfile.sourceSha256, pidProfile.sourceSha256);
  assert.equal(result.original.actualPid, 101); assert.equal(result.fixed.actualPid, 202); assert.equal(result.stableRawGroups, 5);
  assert.equal(result.original.rawObservations.length, 5); assert.equal(result.fixed.rawObservations.length, 5);
  assert.equal(result.inputEquivalenceEstablished, false); assert.equal(result.individualInputIdentitiesQualified, false); assert.equal(result.omissionAuthority, false);
  assert.notDeepEqual(result.original.rawObservations.map(row => row.rawIdentity), result.fixed.rawObservations.map(row => row.rawIdentity));
  assert.equal(sha(gunzipSync(fs.readFileSync(path.join(corpus, 'fixtures/original-cli-client-endpoint.test.ts.txt.gz')), { maxOutputLength: 64 * 1024 })), pidProfile.sourceSha256);
  assert.throws(() => preservesCliFullSuiteObservations(before, after, upstream, 'f'.repeat(64), pidProfile.sourceSha256));
  assert.throws(() => preservesCliFullSuiteObservations(before, after, upstream, pidProfile.sourceSha256, 'f'.repeat(64)));
  for (const change of [
    file => { file.assertionResults.pop(); },
    file => { file.assertionResults.push(structuredClone(file.assertionResults[5])); },
    file => { spell(file.assertionResults[5], { pid: 0, port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: -2, port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: 2147483648, port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: 202.5, port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: '202', port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: 203, port: '27451' }); },
    file => { spell(file.assertionResults[5], { pid: 202, port: 27451 }); },
    file => { spell(file.assertionResults[5], { port: '27451', pid: 202 }); },
    file => { spell(file.assertionResults[5], { pid: 202, port: '27451', host: 12 }); },
    file => { spell(file.assertionResults[9], { pid: 202, port: 27451, host: 13 }); },
    file => { file.assertionResults[5].title += ' '; },
    file => { file.assertionResults[5].fullName += ' drift'; },
    file => { file.assertionResults[5].ancestorTitles = []; },
    file => { file.assertionResults[5].location = { line: 96, column: 3 }; },
    file => { file.assertionResults[5].status = 'pending'; },
    file => { file.assertionResults[0].title = 'unexpected stable title'; },
    file => { file.assertionResults.push({ ancestorTitles: [], title: 'unexpected additional', fullName: 'unexpected additional', status: 'passed' }); },
  ]) {
    const changed = structuredClone(fixed); change(changed.testResults[0]); recount(changed);
    assert.throws(() => preservesCliFullSuiteObservations(before, fullSuiteGroupObservation(changed), upstream, pidProfile.sourceSha256, pidProfile.sourceSha256));
  }
  assert.equal(cliEphemeralPidObservation(after, upstream, pidProfile.sourceSha256).rawObservations.length, 5);
});
