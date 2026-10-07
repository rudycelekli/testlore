#!/usr/bin/env node
// Opt-in evaluation presentation. Ordinary adapter stdout remains unchanged.
import {main} from '../src/adapters/codex.js';
try {
 if(process.argv.length!==2)throw new Error('Evaluation worker accepts no command-line options');
 await main({includeAudit:true});
}catch(error){console.error(error.code||error.message);process.exitCode=1;}
