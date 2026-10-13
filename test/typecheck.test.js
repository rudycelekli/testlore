import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture,write} from './helpers.js';
import {verifyTypecheck} from '../src/typecheck.js';
import {snapshot} from '../src/provenance.js';
import {readConfig} from '../src/files.js';

// Real installed SDK; copied into each project's closed native dependency scope.
// Supports both an ordinary checkout and this private development lane.
const here=path.dirname(fileURLToPath(import.meta.url));
const sdkCandidates=[path.join(here,'../node_modules/typescript'),path.join(here,'../../../../node_modules/typescript')];
const sdk=sdkCandidates.find(directory=>fs.existsSync(path.join(directory,'lib/typescript.js')));
function project(t,extra={}){
  assert.ok(sdk,'Actual installed TypeScript required for native controls');
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'ignored.txt\nnode_modules/\n',
    'tsconfig.json':{compilerOptions:{strict:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true},include:['src/**/*.ts']},
    'src/value.ts':'export const value: number = 42;\n','ignored.txt':'bound ignored input',...extra});
  fs.mkdirSync(path.join(root,'node_modules'),{recursive:true});fs.cpSync(sdk,path.join(root,'node_modules/typescript'),{recursive:true});return root;
}
const check=root=>verifyTypecheck(root,{timeoutMs:20000});
const hook=(root,code)=>{const file=path.join(root,'node_modules/typescript/lib/typescript.js');fs.writeFileSync(file,code+'\n'+fs.readFileSync(file,'utf8'));};

test('native runtime green cannot hide TS2322; healthy inverse is genuinely checked and read-only',t=>{
  const root=project(t,{'src/value.ts':'export const value: string = 42;\n','test/runtime.test.mjs':"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.ts';test('runtime value',()=>assert.equal(value,42));"});
  const runtime=spawnSync(process.execPath,['--experimental-strip-types','--test','test/runtime.test.mjs'],{cwd:root,encoding:'utf8'});assert.equal(runtime.status,0,runtime.stderr);
  const result=check(root);assert.equal(result.status,'failed',JSON.stringify({status:result.status,errorCode:result.errorCode,diagnostics:result.diagnostics}));assert.equal(result.exitCode,1);assert.equal(result.complete,true);assert.ok(result.diagnostics.some(d=>d.code===2322&&d.file==='src/value.ts'&&d.line===1));assert.ok(result.compiler.version);assert.ok(result.binding.source.files.some(row=>row.file==='ignored.txt'));assert.ok(result.files.includes('src/value.ts'));
  write(root,'src/value.ts','export const value: number = 42;\n');const healthy=check(root);assert.equal(healthy.status,'passed',JSON.stringify({status:healthy.status,errorCode:healthy.errorCode,diagnostics:healthy.diagnostics}));assert.equal(healthy.exitCode,0);assert.equal(healthy.complete,true);assert.equal(healthy.diagnostics.length,0);assert.ok(healthy.limitations.some(s=>s.includes('skipLibCheck')));assert.equal(fs.existsSync(path.join(root,'src/value.js')),false);assert.equal(fs.existsSync(path.join(root,'tsconfig.tsbuildinfo')),false);
});

test('missing configuration and missing SDK are actionable incomplete checks',t=>{
  const root=fixture(t,{'package.json':{type:'module'}});const missing=check(root);assert.equal(missing.status,'not-configured');assert.equal(missing.complete,false);assert.equal(missing.exitCode,2);assert.match(missing.nextAction,/tsconfig/);
  write(root,'tsconfig.json',{compilerOptions:{strict:true},files:['src/value.ts']});write(root,'src/value.ts','export const value=1;');const result=check(root);assert.equal(result.errorCode,'typecheck-sdk-missing');assert.equal(result.exitCode,2);
});

test('noCheck, empty, unchecked JS, references and composite profiles never produce partial green',t=>{
  const root=project(t);
  for(const config of [{compilerOptions:{noCheck:true},files:['src/value.ts']},{files:[]},{compilerOptions:{allowJs:true,checkJs:false},files:['src/plain.js']},{files:['src/value.ts'],references:[{path:'./other'}]},{compilerOptions:{composite:true},files:['src/value.ts']}]){
    write(root,'src/plain.js','export const value=42;');write(root,'tsconfig.json',config);const result=check(root);assert.equal(result.status,'incomplete',JSON.stringify({status:result.status,errorCode:result.errorCode,diagnostics:result.diagnostics}));assert.equal(result.exitCode,2);assert.equal(result.complete,false);
  }
});

test('malformed config, missing includes, unresolved modules, and external extends decline complete scope',t=>{
  const root=project(t);for(const config of ['{invalid',JSON.stringify({files:['src/missing.ts']}),JSON.stringify({extends:'../outside.json',files:['src/value.ts']})]){write(root,'tsconfig.json',config);const result=check(root);assert.equal(result.exitCode,2);assert.equal(result.complete,false);}
  write(root,'tsconfig.json',{compilerOptions:{strict:true,module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true},files:['src/value.ts']});write(root,'src/value.ts',"import {x} from 'not-installed';export const value=x;");assert.equal(check(root).errorCode,'typecheck-input-closure-incomplete');
});

test('provenance mismatches reject before executing the installed compiler',t=>{
  const root=project(t),expected=snapshot(root,readConfig(root));hook(root,"require('node:fs').writeFileSync('compiler-entered.txt','yes');");write(root,'src/value.ts','export const value: number=43;');const result=verifyTypecheck(root,{expectedProvenance:expected,timeoutMs:20000});assert.equal(result.errorCode,'typecheck-provenance-mismatch');assert.equal(fs.existsSync(path.join(root,'compiler-entered.txt')),false);
});

test('ignored source and installed dependency mutations during native execution reject green',t=>{
  const root=project(t);hook(root,"require('node:fs').writeFileSync('ignored.txt','drift');");let result=check(root);assert.equal(result.errorCode,'typecheck-source-drift');assert.equal(result.complete,false);
  const compiler=path.join(root,'node_modules/typescript/lib/typescript.js');fs.copyFileSync(path.join(sdk,'lib/typescript.js'),compiler);hook(root,"require('node:fs').writeFileSync('node_modules/added.txt','drift');");result=check(root);assert.equal(result.errorCode,'typecheck-dependency-drift');assert.equal(result.exitCode,2);
});

test('worker malformed output, native timeout and inherited preloads cannot produce green',t=>{
  const root=project(t);hook(root,"process.stdout.write('non-json');");assert.equal(check(root).errorCode,'typecheck-malformed-output');
  fs.copyFileSync(path.join(sdk,'lib/typescript.js'),path.join(root,'node_modules/typescript/lib/typescript.js'));hook(root,'while(true){}');const timed=verifyTypecheck(root,{timeoutMs:1000});assert.equal(timed.errorCode,'typecheck-timeout');assert.equal(timed.exitCode,2);
  fs.copyFileSync(path.join(sdk,'lib/typescript.js'),path.join(root,'node_modules/typescript/lib/typescript.js'));write(root,'preload.cjs',"require('node:fs').writeFileSync('preload-entered.txt','yes');");const previous=process.env.NODE_OPTIONS;try{process.env.NODE_OPTIONS='--require='+path.join(root,'preload.cjs');const result=check(root);assert.equal(result.status,'passed',JSON.stringify({status:result.status,errorCode:result.errorCode,diagnostics:result.diagnostics}));assert.equal(fs.existsSync(path.join(root,'preload-entered.txt')),false);}finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;}
});

test('external source or SDK symlinks are unsupported rather than silently unhashed',t=>{
  const root=project(t),external=fixture(t,{'external.ts':'export const value=1;'});fs.symlinkSync(path.join(external,'external.ts'),path.join(root,'src/external.ts'));assert.equal(check(root).errorCode,'typecheck-external-symlink');
});

test('project traversal and invalid total budgets decline safely',t=>{
  const root=project(t);for(const project of ['../tsconfig.json','/tmp/tsconfig.json','src\\config.json'])assert.equal(verifyTypecheck(root,{project}).errorCode,'typecheck-invalid-project');for(const timeoutMs of [0,-1,NaN,300001])assert.equal(verifyTypecheck(root,{timeoutMs}).errorCode,'typecheck-invalid-timeout');
});

test('native directives expose suppressions and reject unchecked implementation rather than library-only green',t=>{
  const root=project(t);write(root,'src/value.ts','// @ts-nocheck\nexport const value: string=42;');let result=check(root);assert.equal(result.status,'incomplete');assert.equal(result.complete,false);assert.equal(result.errorCode,'typecheck-no-checked-inputs');assert.ok(result.suppressions.some(d=>d.directive==='ts-nocheck'&&d.file==='src/value.ts'));
  write(root,'src/healthy.ts','export const healthy: number=1;');result=check(root);assert.equal(result.errorCode,'typecheck-source-no-check');assert.equal(result.exitCode,2);
  write(root,'src/value.ts','// @ts-ignore\nexport const value: string=42;');result=check(root);assert.equal(result.status,'passed');assert.ok(result.suppressions.some(d=>d.directive==='ts-ignore'));assert.ok(result.limitations.some(d=>d.includes('suppression')));assert.deepEqual(result.files,['src/healthy.ts','src/value.ts']);assert.ok(result.programFiles.length>result.files.length);
  write(root,'src/value.ts','// @ts-expect-error\nexport const value: string=42;');result=check(root);assert.equal(result.status,'passed');assert.ok(result.suppressions.some(d=>d.directive==='ts-expect-error'));
  write(root,'src/value.ts','export const value: string="@ts-ignore @ts-nocheck @ts-expect-error";');result=check(root);assert.equal(result.status,'passed');assert.deepEqual(result.suppressions,[]);
});

test('malformed native diagnostic categories and offsets reject evaluator false greens',t=>{
  const root=project(t),compiler=path.join(root,'node_modules/typescript/lib/typescript.js'),original=fs.readFileSync(compiler,'utf8');
  for(const injected of ["{category:99,code:2322,messageText:'invalid native category'}","{category:1,code:2322,start:NaN,messageText:'invalid native position'}"]){
    const altered=original.replace('function getPreEmitDiagnostics(program, sourceFile, cancellationToken) {',`function getPreEmitDiagnostics(program, sourceFile, cancellationToken) { return [${injected}];`);
    assert.notEqual(altered,original);fs.writeFileSync(compiler,altered);const result=check(root);assert.equal(result.status,'incomplete');assert.equal(result.errorCode,'typecheck-malformed-diagnostic');assert.equal(result.exitCode,2);
  }
});

test('reserved state configurations and real-path aliases never become unbound native inputs',t=>{
  const root=project(t);for(const project of ['.tddswarm/tsconfig.json','.git/tsconfig.json']){const result=verifyTypecheck(root,{project,timeoutMs:20000});assert.equal(result.errorCode,'typecheck-reserved-input');assert.equal(result.exitCode,2);}
  write(root,'.tddswarm/shared.json',{compilerOptions:{strict:true}});write(root,'tsconfig.json',{extends:'./.tddswarm/shared.json',compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',skipLibCheck:true},include:['src/**/*.ts']});let result=check(root);assert.equal(result.errorCode,'typecheck-reserved-input');assert.equal(result.complete,false);
  fs.symlinkSync(path.join(root,'.tddswarm/shared.json'),path.join(root,'shared-alias.json'));write(root,'tsconfig.json',{extends:'./shared-alias.json',files:['src/value.ts']});result=check(root);assert.equal(result.errorCode,'typecheck-reserved-input');assert.equal(result.exitCode,2);
  fs.symlinkSync(path.join(root,'.tddswarm/shared.json'),path.join(root,'config-alias.json'));result=verifyTypecheck(root,{project:'config-alias.json',timeoutMs:20000});assert.equal(result.errorCode,'typecheck-reserved-input');
  write(root,'.tddswarm/source.ts','export const hidden=1;');write(root,'tsconfig.json',{files:['.tddswarm/source.ts']});result=check(root);assert.equal(result.errorCode,'typecheck-reserved-input');assert.equal(result.complete,false);
});
