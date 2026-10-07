const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const helperSha256=hash(fs.readFileSync(__filename));
const files={identityHelperSha256:__filename,loaderSha256:path.join(__dirname,'syntax-engine.cjs'),parserSha256:path.join(__dirname,'source-analysis.cjs'),typescriptPackageSha256:require.resolve('typescript/package.json'),typescriptImplementationSha256:require.resolve('typescript')};
function fingerprint(file){const stat=fs.statSync(file,{bigint:true});return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');}
function inspectEngine(){
 const identity={node:process.version},fingerprints={};
 for(const [key,file]of Object.entries(files)){
  const before=fingerprint(file),sha=hash(fs.readFileSync(file)),after=fingerprint(file);
  if(before!==after||key==='identityHelperSha256'&&sha!==helperSha256)throw new Error('Canonical syntax engine changed during identity capture');
  identity[key]=sha;fingerprints[key]=after;
 }
 return {identity,fingerprints};
}
function assertEngineUnchanged(binding){
 for(const [key,file]of Object.entries(files))if(fingerprint(file)!==binding.fingerprints[key])throw new Error('Canonical syntax engine bytes changed after binding');
}
exports.inspectEngine=inspectEngine;
exports.assertEngineUnchanged=assertEngineUnchanged;
exports.files=Object.freeze(files);
