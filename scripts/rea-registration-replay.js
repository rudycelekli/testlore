#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {registrationHash,observeReaCaseRegistrations,compareReaSkippedRegistrations} from './rea-case-registration.js';
const defaultDirectory=fileURLToPath(new URL('../benchmarks/rea-case-registration/native-pass-20261009/',import.meta.url));
export function verifyCapturedReaRegistrations(directory=defaultDirectory){
 const archiveSha='c96000c574720975850e11e92cf1e3fcb32ecc52b57abb39787dd0b5cf9aac9f',revision='c124677344aad9f4d2bdba70a48c43c9d0b378cb';
 const bounded=file=>{const target=path.join(directory,file),stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('Bounded regular frozen member required');return fs.readFileSync(target);};
 const integrityBytes=bounded('integrity.json');if(registrationHash(integrityBytes)!=='b26b6064a371fa2cb5025b0be48d92d2976952266ddcc287c3e7bf9582ca18f8')throw Error('Frozen native registration member index changed');const integrity=JSON.parse(integrityBytes),archive=bounded('original-artifact.zip');
 if(integrity.runId!==37950751379||integrity.artifactId!==11626405703||integrity.sourceRevision!==revision||integrity.artifactSha256!==archiveSha||integrity.artifactBytes!==archive.length||registrationHash(archive)!==archiveSha)throw Error('Frozen native registration archive changed');
 const read=file=>{const bytes=bounded(file),binding=integrity.members[file];if(!binding||binding.bytes!==bytes.length||binding.sha256!==registrationHash(bytes))throw Error('Frozen native registration member changed');return bytes.toString('utf8');};
 const profile=JSON.parse(read('profile.json')),manifest=profile.manifest;
 // Fixed by the independent original-source/lock reconstruction, not learned from titles.
 if(profile.producerRevision!==revision||registrationHash(manifest)!=='3bc453acdf66eb07d8848efb7f7c013d36dedb96a2366341daab5a1ceeccb08b'||manifest.upstreamRevision!=='3dcb732da33f6ceef597506b14a4536f1c9aff96'||manifest.omissionAuthority!==false)throw Error('Frozen independently reconstructed registration profile changed');
 const arms=[0,1].map(index=>{
  const receipt=observeReaCaseRegistrations(read(`native-${index}/stdout.log`),manifest),raw=JSON.parse(read(`native-${index}/native.json`)),event=JSON.parse(read(`native-${index}.json`));
  if(event.event.exitCode!==0||event.event.reason||raw.success!==true||raw.numPassedTests!==14||raw.numPendingTests!==3||raw.numFailedTests!==0||raw.testResults?.length!==1)throw Error('Original native outcome scope changed');
  const skipped=raw.testResults[0].assertionResults.filter(t=>t.status==='skipped');if(skipped.length!==3||JSON.stringify(skipped.map(t=>t.fullName).sort())!==JSON.stringify(receipt.observations.map(t=>t.rawName).sort()))throw Error('Native skipped names do not bind actual registration receipts');
  const stored=JSON.parse(read(`registration-${index}.json`));if(JSON.stringify(stored.observations)!==JSON.stringify(receipt.observations)||stored.complete!==true||stored.independentlyRechecked!==true)throw Error('Retained native receipt differs');return receipt.observations;
 });
 const checked=compareReaSkippedRegistrations(manifest,arms),recorded=JSON.parse(read('assessment.json'));if(!checked.complete||recorded.complete!==true||recorded.producerRevision!==revision||recorded.omissionAuthority!==false||recorded.inputEquivalenceClaim!==false)throw Error('Frozen native registration verdict changed');
 return{schemaVersion:1,observationReplayed:true,runId:37950751379,sourceRevision:revision,artifactSha256:archiveSha,complete:true,arms:2,actualSkippedRegistrationsPerArm:3,omissionAuthority:false,inputEquivalenceClaim:false,scope:'Replays actual native skipped receipts and raw outcome correspondence; neither new execution nor routing/performance qualification.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyCapturedReaRegistrations(process.argv[2]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
