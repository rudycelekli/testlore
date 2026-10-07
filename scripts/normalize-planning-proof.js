import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashFile=filename=>digest(fs.readFileSync(filename));
export function normalizePlanningProof({receipt,journal,nodeExecutable,repository,outputReceipt,outputJournal}) {
  if(!path.isAbsolute(nodeExecutable)||!path.isAbsolute(repository))throw new Error('Normalization requires explicit absolute runtime and repository paths');
  const rawReceipt=fs.readFileSync(receipt),rawJournal=fs.readFileSync(journal);
  const bindings={rawReceiptSha256:digest(rawReceipt),rawJournalSha256:digest(rawJournal),normalizerSha256:hashFile(fileURLToPath(import.meta.url))};
  let replacedStrings=0;
  function normalize(value) {
    if(Array.isArray(value))return value.map(normalize);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));
    if(typeof value!=='string')return value;
    const normalized=value.replaceAll(nodeExecutable,'<node-executable>').replaceAll(repository,'<candidate-repository>');
    if(normalized!==value)replacedStrings++;
    if(normalized.includes('/Users/'))throw new Error('Unmapped personal filesystem path');
    return normalized;
  }
  const report=normalize(JSON.parse(rawReceipt));
  const lines=rawJournal.toString('utf8').trim().split('\n').map(line=>normalize(JSON.parse(line)));
  const normalization={schemaVersion:1,...bindings,replacedStrings,
    replacements:['absolute-node-executable-prefix','absolute-candidate-repository-prefix'],
    placeholders:['<node-executable>','<candidate-repository>'],originalArtifactsRetainedLocally:true,
    scope:'Public copy replaces known absolute path prefixes only. All numerical measurements, failures, case IDs, statuses, source hashes, fingerprints and attempt ordering are retained. Raw artifacts are authoritative; normalized runner paths are not executable commands.'};
  report.publicNormalization=normalization;
  const publicJournal=[{event:'public-normalization',...normalization},...lines].map(line=>JSON.stringify(line)).join('\n')+'\n';
  // A caller archives immutable originals first and chooses unused outputs.
  const receiptFd=fs.openSync(outputReceipt,'wx',0o600);
  try {fs.writeFileSync(receiptFd,JSON.stringify(report,null,2)+'\n');}finally{fs.closeSync(receiptFd);}
  const journalFd=fs.openSync(outputJournal,'wx',0o600);
  try {fs.writeFileSync(journalFd,publicJournal);}finally{fs.closeSync(journalFd);}
  return normalization;
}
