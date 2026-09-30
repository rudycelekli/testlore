import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fixture,commit,git,write} from './helpers.js';import {sealSourceArchive} from '../scripts/archive-source.js';
test('sealed archive adds an exact action SHA without changing source or executing package scripts',t=>{
 const root=fixture(t,{'package.json':{name:'testlore-archive-fixture',version:'0.0.1',files:['src'],scripts:{prepack:"node -e \"require('fs').writeFileSync('executed','unsafe')\""}},'src/index.js':'export const answer=42;'});commit(root);
 const revision=git(root,'rev-parse','HEAD').trim(),original=fs.readFileSync(path.join(root,'package.json'),'utf8'),output=fixture(t,{});
 const pack=sealSourceArchive(root,revision,output),archive=path.join(output,pack.filename),entry=file=>{const r=spawnSync('tar',['-xOf',archive,'package/'+file],{encoding:'utf8',shell:false});assert.equal(r.status,0,r.stderr);return r.stdout;};
 assert.equal(JSON.parse(entry('package.json')).gitHead,revision);assert.equal(entry('src/index.js'),'export const answer=42;');assert.equal(pack.actionReference,revision);assert.equal(pack.recipe,'tracked-source-with-exact-gitHead');assert.equal(fs.existsSync(path.join(root,'executed')),false);assert.equal(fs.readFileSync(path.join(root,'package.json'),'utf8'),original);assert.equal(git(root,'status','--porcelain'),'');
 write(root,'src/index.js','export const answer=0;');assert.throws(()=>sealSourceArchive(root,revision,output),/clean exact revision/);
});
