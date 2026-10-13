import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {improve} from '../src/improvement.js';
import {publishImprovement} from '../src/pull-request.js';
import {fixture,write,commit,git} from './helpers.js';

test('typed test improvements use fresh publication evidence and preserve physical dependencies',async t=>{
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\n',
  'src/value.ts':'export const value: number = 42;\n',
  'tsconfig.json':{compilerOptions:{strict:true,noEmit:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022'},files:['src/value.ts']},
  'test/original.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('original contract',()=>assert.equal(value,42));",
  'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--experimental-strip-types','--no-warnings','--test','{files}'],plugins:{typescript:{enabled:true}}}});
 commit(root);fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(path.resolve('node_modules/typescript'),path.join(root,'node_modules/typescript'),{recursive:true});
 const content="import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('independent boundary',()=>assert.equal(value+1,43));";
 const result=await improve(root,{patch:{files:[{path:'test/additional.test.mjs',content}],requirements:'Independent contract: value is42 and adding1 yields43.',review:{accepted:true,findings:[],oracle:{independent:true,basis:['Independent public numeric contract.']}}},timeoutMs:10000,totalTimeoutMs:120000});
 t.after(()=>{try{git(root,'worktree','remove','--force',result.worktreeRoot);}catch{}try{git(root,'branch','-D',result.branch);}catch{}fs.rmSync(result.worktreeRoot,{recursive:true,force:true});});
 assert.equal(result.status,'ready-for-review',JSON.stringify({status:result.status,error:result.error,type:result.typecheck}));
 assert.equal(result.fullRun.typecheck.status,'passed');assert.equal(result.fullRun.provenance.revision,result.sha);
 const missing=structuredClone(result);delete missing.fullRun.typecheck;delete missing.typecheck;
 assert.throws(()=>publishImprovement(root,missing),/completed final TypeScript verification/);
 const wrong=structuredClone(result);wrong.fullRun.typecheck.compiler.sha256='0'.repeat(64);wrong.typecheck=wrong.fullRun.typecheck;
 assert.throws(()=>publishImprovement(root,wrong),/compiler changed/);
 const bare=fixture(t);git(bare,'init','--bare');git(root,'remote','add','origin','https://github.com/type-proof/project.git');git(root,'config',`url.${bare}.pushInsteadOf`,'https://github.com/type-proof/project.git');
 const requests=path.join(result.worktree,'.tddswarm/publication-requests.jsonl'),script=path.join(result.worktree,'.tddswarm/github.cjs');
 const metadata={url:'https://github.com/type-proof/project/pull/123',headRefOid:result.sha,headRefName:result.branch,baseRefName:result.baseBranch,state:'OPEN',isDraft:false};
 write(result.worktree,'.tddswarm/github.cjs',`const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify(a)+'\\n');if(a[0]==='repo')console.log('{}');else if(a[1]==='create')console.log(${JSON.stringify(metadata.url)});else console.log(${JSON.stringify(JSON.stringify(metadata))});`);
 const sdk=path.join(result.worktree,'node_modules/typescript/lib/typescript.js'),original=fs.readFileSync(sdk);fs.appendFileSync(sdk,'\n// changed installed compiler\n');
 assert.throws(()=>publishImprovement(root,result,{command:[process.execPath,script]}),/inputs changed|compiler changed/);assert.equal(fs.existsSync(requests),false);fs.writeFileSync(sdk,original);
 const published=publishImprovement(root,result,{command:[process.execPath,script]});
 assert.equal(published.published,true);assert.equal(git(bare,'rev-parse',`refs/heads/${result.branch}`).trim(),result.sha);
 assert.equal(fs.lstatSync(path.join(result.worktree,'node_modules')).isDirectory(),true);assert.equal(fs.readFileSync(path.join(root,'src/value.ts'),'utf8'),'export const value: number = 42;\n');
 assert.match(fs.readFileSync(path.join(result.worktree,'.tddswarm/pull-request.md'),'utf8'),/TypeScript checking: passed/);
 // The Git push targets a temporary bare repository; the CLI above is a
 // deterministic protocol fixture, not a live GitHub/model qualification.
});
