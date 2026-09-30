#!/usr/bin/env node
// Raw evidence is retained privately; stdout contains only the aggregate allowlist.
import fs from 'node:fs';
import path from 'node:path';
import { pilot, exportPilot } from '../src/pilot.js';

const args = process.argv.slice(2);
const manifestIndex = args.indexOf('--manifest');
const outputIndex = args.indexOf('--output');
if (manifestIndex < 0 || !args[manifestIndex + 1] || !args.includes('--execute')) throw new Error('Use history-replay.js --manifest <private manifest> --execute [--output .tddswarm/pilots/<new-run>]');
const manifest = JSON.parse(fs.readFileSync(path.resolve(args[manifestIndex + 1]), 'utf8'));
if (!manifest.projects?.every(project => project.changes?.every(change => change.kind === 'history'))) throw new Error('History replay requires immutable history changes only');
const report = pilot(process.cwd(), manifest, { execute: true, ...(outputIndex < 0 ? {} : { output: args[outputIndex + 1] }) });
process.stdout.write(JSON.stringify(exportPilot(report), null, 2) + '\n');
process.exitCode = report.valid ? 0 : 1;
