#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/provenance.js';

const text = (value, max) => typeof value === 'string' && value.trim() && !value.includes('\0') && Buffer.byteLength(value) <= max;
const units = dataset => dataset.fixtures.map(fixture => ({ specificationId: fixture.specificationId, requirementsHash: digest(fixture.requirements), sourceHash: digest(fixture.files), referenceHash: digest(fixture.referenceTests), defectsHash: digest(fixture.defects) }));

/** A commitment binds supplied bytes; it cannot verify authorship, secrecy or publication time. */
export function commitDataset(dataset, provenance) {
  if (!dataset || dataset.schemaVersion !== 1 || !Array.isArray(dataset.fixtures) || dataset.fixtures.length < 2 || dataset.fixtures.length > 12) throw new Error('Commitment requires a bounded evaluation dataset');
  if (!provenance || !text(provenance.owner, 200) || !text(provenance.source, 1000) || !text(provenance.independenceNotes, 2000) || typeof provenance.independentlyMaintained !== 'boolean') throw new Error('Declare dataset owner, source, independence notes and independentlyMaintained boolean');
  return { schemaVersion: 1, kind: 'evaluation-dataset-commitment', datasetId: dataset.id, datasetHash: digest(dataset), units: units(dataset), provenance: { owner: provenance.owner, source: provenance.source, independenceNotes: provenance.independenceNotes, independentlyMaintained: provenance.independentlyMaintained }, createdAt: new Date().toISOString(), scope: 'Local content commitment; owner and independence are declarations. No trusted timestamp, external publication, access isolation or semantic independence attestation.' };
}
export function verifyDatasetCommitment(dataset, commitment) {
  const expected = commitDataset(dataset, commitment?.provenance);
  if (commitment.schemaVersion !== 1 || commitment.kind !== expected.kind || commitment.datasetId !== expected.datasetId || commitment.datasetHash !== expected.datasetHash || JSON.stringify(commitment.units) !== JSON.stringify(expected.units) || !text(commitment.createdAt, 80) || !Number.isFinite(Date.parse(commitment.createdAt))) throw new Error('Dataset commitment mismatch; use the prospectively frozen dataset without tuning labels');
  return { ...commitment, verified: true, authorshipVerified: false, independenceVerified: false, externallyAnchored: false };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 6 || argv[0] !== '--dataset' || argv[2] !== '--provenance' || argv[4] !== '--output') throw new Error('Use --dataset dataset.json --provenance provenance.json --output new-commitment.json');
  const { validateDataset } = await import('./learning-evaluation.js');
  const read = filename => { const bytes = fs.readFileSync(filename); if (bytes.length > 2 * 1024 * 1024) throw new Error('Commitment input exceeds 2 MB'); return JSON.parse(bytes); };
  const dataset = validateDataset(read(argv[1])), commitment = commitDataset(dataset, read(argv[3]));
  fs.writeFileSync(path.resolve(argv[5]), JSON.stringify(commitment, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return commitment;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { console.log(JSON.stringify(await main(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
