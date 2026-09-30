#!/usr/bin/env node
// This verifies a published archive; it never publishes or substitutes a new pack.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--receipt')throw new Error('Use --receipt qualified-release-candidate.json');
const verify=spawnSync(process.execPath,[fileURLToPath(new URL('./release-candidate.js',import.meta.url)),'--verify',path.resolve(args[1])],{encoding:'utf8',shell:false,timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
if(verify.status!==0||verify.error)throw new Error('Source lineage and qualified artifact could not be verified');
const receipt=JSON.parse(fs.readFileSync(args[1],'utf8'));
if(receipt.schemaVersion!==1||!receipt.qualified||!/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(receipt.version)||!/^[a-f0-9]{64}$/.test(receipt.archiveSha256))throw new Error('Invalid qualified receipt');
const result=spawnSync('npm',['view',`testlore@${receipt.version}`,'dist','--json'],{encoding:'utf8',shell:false,timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
if(result.status!==0||result.error)throw new Error('Registry metadata could not be verified');
const dist=JSON.parse(result.stdout),url=new URL(dist.tarball);
if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.username||url.password)throw new Error('Unexpected registry archive URL');
const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error('Registry archive download failed');
const chunks=[];let size=0;
for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024)throw new Error('Registry archive exceeds bound');chunks.push(chunk);}
const bytes=Buffer.concat(chunks),sha256=createHash('sha256').update(bytes).digest('hex'),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
if(sha256!==receipt.archiveSha256||integrity!==dist.integrity||receipt.npmIntegrity!==dist.integrity)throw new Error('Registry bytes differ from the qualified archive');
fs.writeFileSync(path.join(path.dirname(fs.realpathSync(args[1])),'registry-proof.json'),JSON.stringify({schemaVersion:1,sourceRevision:receipt.sourceRevision,version:receipt.version,archiveSha256:sha256,registryIntegrity:integrity,exactBytes:true,date:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:receipt.version,exactBytes:true,archiveSha256:sha256}));
