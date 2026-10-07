#!/usr/bin/env node
// Opt-in evaluation presentation. Ordinary adapter stdout remains unchanged.
import {main} from '../src/adapters/codex.js';
import {describeWorkerFailure} from '../src/adapters/codex-protocol.js';
try {
 if(process.argv.length!==2)throw new Error('Evaluation worker accepts no command-line options');
 await main({includeAudit:true});
}catch(error){console.error(JSON.stringify(describeWorkerFailure(error)));process.exitCode=1;}
