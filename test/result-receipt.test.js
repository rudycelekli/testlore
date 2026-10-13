import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {persistResultReceipt,writeResultReceipt} from '../src/result-receipt.js';
import {repair} from '../src/repair.js';
import {fixture,write,commit,git,twoModules} from './helpers.js';
import {challengeFiles} from './repair-challenge-fixtures.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const requirements='Module a exports1; independent module b remains2.';
function cleanWorktree(t,root,result){if(result.worktreeRoot)t.after(()=>{try{git(root,'worktree','remove','--force',result.worktreeRoot);}catch{}fs.rmSync(result.worktreeRoot,{recursive:true,force:true});});}
const nativeEnv=()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;return env;};
test('atomic result receipts replace healthy metadata and preserve confirmed publication facts on refusal',t=>{
 const root=fixture(t,{'src/value.js':'verified source'}),result={status:'ready-for-review',published:true,pullRequest:'https://github.com/test-owner/project/pull/123',pullRequestVerification:{headRefOid:'a'.repeat(40)}};
 persistResultReceipt(root,result,'.tddswarm/improvement/result.json');const receipt=result.receipt;
 assert.equal(JSON.parse(fs.readFileSync(receipt)).published,true);result.receipt=path.join(root,'.tddswarm/improvement/result.json');persistResultReceipt(root,result);assert.equal(result.status,'ready-for-review');
 fs.unlinkSync(receipt);fs.symlinkSync('../../src/value.js',receipt);persistResultReceipt(root,result);
 assert.equal(result.status,'receipt-failed');assert.equal(result.receipt,null);assert.equal(result.published,true);assert.match(result.pullRequest,/pull\/123$/);assert.equal(result.pullRequestVerification.headRefOid,'a'.repeat(40));assert.equal(result.exitCode,2);assert.equal(fs.readFileSync(path.join(root,'src/value.js'),'utf8'),'verified source');
});
test('receipt paths refuse hardlinks, linked ancestors, special leaves, escapes, control paths and oversized metadata',t=>{
 const root=fixture(t,{'src/value.js':'verified source'}),source=path.join(root,'src/value.js');
 write(root,'.tddswarm/receipt/result.json','old');const leaf=path.join(root,'.tddswarm/receipt/result.json');fs.unlinkSync(leaf);fs.linkSync(source,leaf);
 assert.throws(()=>writeResultReceipt(root,{},'.tddswarm/receipt/result.json'),/unlinked regular/);fs.unlinkSync(leaf);fs.mkdirSync(leaf);assert.throws(()=>writeResultReceipt(root,{},'.tddswarm/receipt/result.json'),/unlinked regular/);fs.rmSync(leaf,{recursive:true});
 fs.symlinkSync('receipt',path.join(root,'.tddswarm/linked'));assert.throws(()=>writeResultReceipt(root,{},'.tddswarm/linked/result.json'),/ancestors/);
 for(const target of ['src/value.js','.tddswarm/../src/value.json','.tddswarm/\x1b[31m.json'])assert.throws(()=>writeResultReceipt(root,{},target),/bounded local/);
 assert.throws(()=>writeResultReceipt(root,{data:'x'.repeat(32*1024*1024)},'.tddswarm/receipt/result.json'),/32 MiB/);
 assert.equal(fs.readFileSync(source,'utf8'),'verified source');assert.equal(fs.readdirSync(path.dirname(leaf)).some(x=>x.endsWith('.tmp')),false);
});
for(const link of ['symbolic','hard'])test(`actual repaired native test cannot clobber source through a ${link} result alias`,async t=>{
 const root=fixture(t,{...twoModules,...challengeFiles,'src/a.js':'export const a=9;','tddswarm.requirements.md':requirements,'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--test','{files}'],repair:{challenges:'quality/challenges.json'}},
 'test/a.test.js':`import {a} from '../src/a.js';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('a',()=>{assert.equal(a,1);fs.mkdirSync('.tddswarm/repair',{recursive:true});try{${link==='symbolic'?"fs.symlinkSync('../../src/a.js','.tddswarm/repair/result.json')":"fs.linkSync('src/a.js','.tddswarm/repair/result.json')"};}catch(e){if(e.code!=='EEXIST')throw e;}});`});commit(root);
 const fixed='export const a=1;',result=await repair(root,{patch:{files:[{path:'src/a.js',content:fixed}],review:{accepted:true,findings:[],oracle:{independent:true,basis:[requirements]}}},sourcePaths:['src/a.js'],deadlineMs:60000});cleanWorktree(t,root,result);
 assert.equal(result.status,'receipt-failed',JSON.stringify(result));assert.equal(result.validation.accepted,true);assert.equal(result.fullRun.exitCode,0);assert.ok(result.sha);assert.equal(result.receipt,null);assert.equal(result.published,false);
 assert.equal(fs.readFileSync(path.join(result.worktree,'src/a.js'),'utf8'),fixed);assert.equal(fs.readFileSync(path.join(root,'src/a.js'),'utf8'),'export const a=9;');
 const repeat=spawnSync(process.execPath,['--test','test/a.test.js','test/b.test.js'],{cwd:result.worktree,encoding:'utf8',env:nativeEnv(),timeout:10000});assert.equal(repeat.status,0,repeat.stderr+repeat.stdout);assert.match(repeat.stdout,/# tests 2/);
});
test('actual CLI retains verified local PR metadata while refusing a late service-probe receipt alias',t=>{
 const original='/** @type {number} */ export const value=42;';
 const probe="const fs=require('fs'),p='.tddswarm/improvement/result.json';if(fs.existsSync(p)&&!fs.lstatSync(p).isSymbolicLink()){fs.unlinkSync(p);fs.symlinkSync('../../src/value.js',p);fs.appendFileSync('.tddswarm/alias-observed','alias-created');}process.stdout.write('stable-service-version');";
 const root=fixture(t,{'.gitignore':'.tddswarm/\nnode_modules/\n','package.json':{type:'module'},'src/value.js':original,'test/value.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.js';test('value',()=>assert.equal(value,42));",'tsconfig.json':{compilerOptions:{strict:true,allowJs:true,checkJs:true,noEmit:true,skipLibCheck:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022'},files:['src/value.js']},'tddswarm.config.json':{adapter:'node',runner:[process.execPath,'--test','{files}'],plugins:{typescript:{enabled:true,timeoutMs:10000}},services:{example:{tests:['test/value.test.js'],probe:[process.execPath,'-e',probe]}}},'tddswarm.requirements.md':'Value42 remains unchanged; successor43 is an independent boundary.'});
 fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(path.resolve('node_modules/typescript'),path.join(root,'node_modules/typescript'),{recursive:true});commit(root);
 const bare=fixture(t);git(bare,'init','--bare');const url='https://github.com/type-proof/project.git';git(root,'remote','add','origin',url);git(root,'config',`url.${bare}.pushInsteadOf`,url);
 const bin=path.join(root,'.tddswarm/bin');fs.mkdirSync(bin,{recursive:true});
 write(root,'.tddswarm/bin/gh',`#!${process.execPath}\nimport fs from 'node:fs';import cp from 'node:child_process';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(path.join(root,'.tddswarm/gh-requests'))},JSON.stringify(args)+'\\n');if(args[0]==='repo')console.log('{}');else if(args[1]==='create')console.log('https://github.com/type-proof/project/pull/123');else {const git=a=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();console.log(JSON.stringify({url:'https://github.com/type-proof/project/pull/123',headRefOid:git(['rev-parse','HEAD']),headRefName:git(['symbolic-ref','--short','HEAD']),baseRefName:'main',state:'OPEN',isDraft:false}));}`);fs.chmodSync(path.join(bin,'gh'),0o700);
 write(root,'.tddswarm/proposal.json',{files:[{path:'test/boundary.test.js',content:"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.js';test('boundary',()=>assert.equal(value+1,43));"}],requirements:'Value42 and successor43.',review:{accepted:true,findings:[],oracle:{independent:true,basis:['Maintainer value42 and successor43 contract.']}}});
 const response=spawnSync(process.execPath,[cli,'improve','--root',root,'--patch','.tddswarm/proposal.json','--no-ci','--json'],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:{...nativeEnv(),PATH:bin+path.delimiter+process.env.PATH}});
 assert.equal(response.status,2,response.stderr+response.stdout);const result=JSON.parse(response.stdout);cleanWorktree(t,root,result);
 assert.equal(result.status,'receipt-failed',JSON.stringify(result));assert.equal(result.published,true,result.publicationError||result.receiptError);assert.equal(result.pullRequest,'https://github.com/type-proof/project/pull/123');assert.equal(result.pullRequestVerification.headRefOid,result.sha);assert.equal(result.receipt,null);assert.equal(result.fullRun.typecheck.status,'passed');assert.equal(fs.readFileSync(path.join(result.worktree,'src/value.js'),'utf8'),original);assert.equal(fs.readFileSync(path.join(root,'src/value.js'),'utf8'),original);assert.ok(fs.existsSync(path.join(result.worktree,'.tddswarm/alias-observed')));
 assert.equal(git(bare,'rev-parse',`refs/heads/${result.branch}`).trim(),result.sha);
 const repeat=spawnSync(process.execPath,['--test','test/value.test.js','test/boundary.test.js'],{cwd:result.worktree,encoding:'utf8',timeout:10000,env:nativeEnv()});assert.equal(repeat.status,0,repeat.stderr+repeat.stdout);assert.match(repeat.stdout,/# tests 2/);
 // Real local Git, Node and SDK; deterministic gh only, no external publication.
});
