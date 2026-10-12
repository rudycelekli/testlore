export const challengeManifest={schemaVersion:1,independent:true,basis:'Maintainer-owned unchanged module b contract; independent of proposed module a repair.',cases:[{id:'preserved-b-value',script:'quality/preserved.cjs'}]};
export const challengeFiles={
 'quality/challenges.json':challengeManifest,
 'quality/preserved.cjs':"module.exports=async ({assert,root})=>{const {pathToFileURL}=require('url');const {b}=await import(pathToFileURL(require('path').join(root,'src/b.js')).href);assert.strictEqual(b,2);};"
};
