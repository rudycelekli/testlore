#!/usr/bin/env node
// Seal once, qualify that exact archive, and verify it again before a protected publish.
import fs from 'node:fs';
import {sealSourceArchive} from './archive-source.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function invoke(argv){const result=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:'utf8',shell:false,timeout:180000,killSignal:'SIGKILL',maxBuffer:16*1024*1024});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr+'\n'+result.stdout);return result.stdout;}
function revision(){return invoke(['git','rev-parse','HEAD']).trim();}
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){const key=args[i];if(key==='--publish-check'){options.publish=true;continue;}if(!['--output','--verify','--revision'].includes(key)||!args[i+1]||options[key])throw new Error('Expected --output NEW_DIR or --verify RECEIPT [--publish-check] [--revision SHA]');options[key]=args[++i];}
if(options['--verify']){
 if(invoke(['git','status','--porcelain']).trim())throw new Error('Verification requires a clean immutable source checkout');
 const file=path.resolve(options['--verify']),receipt=JSON.parse(fs.readFileSync(file,'utf8'));
 if(receipt.schemaVersion!==1||receipt.sourceRevision!==revision()||!/^testlore-[A-Za-z0-9.+_-]+\.tgz$/.test(receipt.archive)||!receipt.qualified||!receipt.archiveSha256||!receipt.proofSha256)throw new Error('Release receipt is invalid or belongs to another source revision');
 if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==receipt.version)throw new Error('Release version differs from checked-out source');
 const directory=path.dirname(file),archive=path.join(directory,receipt.archive),proof=path.join(directory,'packed-proof.json');
 if(hash(archive)!==receipt.archiveSha256||hash(proof)!==receipt.proofSha256)throw new Error('Sealed archive or packed proof changed');
 const evidence=JSON.parse(fs.readFileSync(proof,'utf8'));if(evidence.sha256!==receipt.archiveSha256||evidence.version!==receipt.version||evidence.exactInputArchive!==true||evidence.proofScriptSha256!==hash(path.join(root,'scripts/packed-proof.js'))||!evidence.productionInstall||receipt.archiveRecipe!=='tracked-source-with-exact-gitHead'||evidence.actionReference!==receipt.sourceRevision||receipt.sourceManifestSha256!==hash(path.join(root,'package.json'))||!evidence.nativeShadow?.complete||!evidence.nativeShadow?.detected||!evidence.runtimeCaptureComplete||evidence.improvement?.status!=='ready-for-review')throw new Error('Packed artifact evidence incomplete');
 if(options.publish&&(!/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(receipt.version)||process.env.NODE_AUTH_TOKEN||process.env.NPM_TOKEN))throw new Error('Publish requires a valid scoped alpha candidate version and token-free trusted OIDC');
 if(options.publish&&(process.env.GITHUB_ACTIONS!=='true'||!process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN))throw new Error('Publish check requires a GitHub Actions OIDC-enabled job; publisher mapping is still an external gate');
 console.log(JSON.stringify({...receipt,verified:true,alphaVersionEligible:/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(receipt.version)},null,2));
}else{
 if(!options['--output']||options.publish)throw new Error('--output new-directory required; publishing is never performed by this script');
 const sourceRevision=revision();if(options['--revision']&&options['--revision']!==sourceRevision)throw new Error('Checkout differs from requested immutable revision');
 if(invoke(['git','status','--porcelain']).trim())throw new Error('Seal requires a clean committed checkout');
 const output=path.resolve(options['--output']);if(fs.existsSync(output))throw new Error('Preserve prior evidence: output must be new');fs.mkdirSync(output,{recursive:true});
 const pack=sealSourceArchive(root,sourceRevision,output);
 const tracked=new Set(invoke(['git','ls-files','-z']).split('\0'));
 if(!Array.isArray(pack.files)||pack.files.some(file=>!tracked.has(file.path)))throw new Error('Archive contains files outside the committed source tree');
 const archive=path.join(output,pack.filename), archiveSha256=hash(archive);
 invoke([process.execPath,path.join(root,'scripts/packed-proof.js'),'--archive',archive,'--expected-sha256',archiveSha256,'--expected-source-sha',sourceRevision,'--output',path.join(output,'packed-proof.json')]);
 if(hash(archive)!==archiveSha256||revision()!==sourceRevision||invoke(['git','status','--porcelain']).trim())throw new Error('Release source or archive drifted');
 const receipt={schemaVersion:1,sourceRevision,archiveRecipe:pack.recipe,sourceManifestSha256:pack.sourceManifestSha256,packedManifestSha256:pack.packedManifestSha256,archive:pack.filename,archiveSha256,npmIntegrity:pack.integrity,version:pack.version,node:process.version,qualified:true,proofSha256:hash(path.join(output,'packed-proof.json')),date:new Date().toISOString(),publisherVerified:false,limitations:['Exact local packed-artifact qualification; no registry credentials, OIDC publisher mapping, GitHub protected environment, or hosted CI run certified.','Source tests and hosted gates must also pass at this exact revision before publication.']};
 fs.writeFileSync(path.join(output,'release-candidate.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt,null,2));
}
