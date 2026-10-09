import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withRepairEnvironment} from '../src/repair-environment.js';
import {nativeEnvironment} from '../src/execution.js';
import {stageRepair,validateRepair} from '../src/repair-candidates.js';
import {fixture,commit} from './helpers.js';

test('real native subprocess receives masked credentials and fresh standard profiles without host mutation',()=>{
  const credentials={OPENAI_API_KEY:'synthetic-openai-secret',GH_TOKEN:'synthetic-gh-secret',npm_token:'synthetic-npm-secret',PASSWORD:'synthetic-password',CLIENT_PRIVATE_KEY:'synthetic-private-key',SSH_AUTH_SOCK:'/synthetic/ssh-agent',AUTHORIZATION:'synthetic-authorization',AWS_ACCESS_KEY_ID:'synthetic-access-key',SESSION_COOKIE:'synthetic-cookie',CODEX_APP_TOOLS_PIPE_PATH:'/synthetic/agent-tool-pipe'};
  const before={...process.env},config={env:{...credentials,FEATURE_LABEL:'ordinary-value',HOME:'/synthetic/host-home',CODEX_HOME:'/synthetic/codex',NPM_CONFIG_USERCONFIG:'/synthetic/.npmrc'}},homes=[];
  for(let repetition=0;repetition<2;repetition++){
    const outcome=withRepairEnvironment(config,isolated=>{
      homes.push(isolated.env.HOME);assert.equal(fs.statSync(isolated.env.HOME).mode&0o777,0o700);
      const code=`const fs=require('node:fs');console.log(JSON.stringify({credentials:Object.fromEntries(${JSON.stringify(Object.keys(credentials))}.map(k=>[k,process.env[k]??null])),label:process.env.FEATURE_LABEL,home:process.env.HOME,npm:fs.readFileSync(process.env.NPM_CONFIG_USERCONFIG,'utf8'),global:fs.readFileSync(process.env.NPM_CONFIG_GLOBALCONFIG,'utf8'),codex:process.env.CODEX_HOME??null,git:fs.readFileSync(process.env.GIT_CONFIG_GLOBAL,'utf8')}));`;
      const run=spawnSync(process.execPath,['-e',code],{env:nativeEnvironment(isolated),encoding:'utf8',timeout:2000,maxBuffer:65536});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
    });
    assert.equal(outcome.label,'ordinary-value');assert.equal(outcome.npm,'');assert.equal(outcome.global,'');assert.equal(outcome.git,'');assert.equal(outcome.codex,null);
    for(const value of Object.values(outcome.credentials))assert.equal(value,null);
    for(const secret of Object.values(credentials))assert.equal(JSON.stringify(outcome).includes(secret),false);
    assert.equal(fs.existsSync(outcome.home),false);
  }
  assert.notEqual(homes[0],homes[1]);assert.equal(JSON.stringify({...process.env})===JSON.stringify(before),true,'Host environment must remain unchanged');assert.equal(config.env.OPENAI_API_KEY,credentials.OPENAI_API_KEY);
});

test('inherited credentials are overridden even when config tries to reintroduce them',()=>{
  const helper=new URL('../src/repair-environment.js',import.meta.url).href;
  const code=`import {withRepairEnvironment} from ${JSON.stringify(helper)};import {spawnSync} from 'node:child_process';const before=process.env.TESTLORE_INHERITED_TOKEN;const result=withRepairEnvironment({env:{testlore_inherited_password:'configured-secret',TESTLORE_INHERITED_TOKEN:'reintroduced-secret'}},c=>{const r=spawnSync(process.execPath,['-e','console.log(JSON.stringify({token:process.env.TESTLORE_INHERITED_TOKEN??null,password:process.env.testlore_inherited_password??null}))'],{env:{...process.env,...c.env},encoding:'utf8'});return JSON.parse(r.stdout)});console.log(JSON.stringify({result,hostIntact:before===process.env.TESTLORE_INHERITED_TOKEN}));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TESTLORE_INHERITED_TOKEN:'inherited-synthetic-secret'},encoding:'utf8',timeout:3000,maxBuffer:65536});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{result:{token:null,password:null},hostIntact:true});assert.equal(run.stdout.includes('synthetic-secret'),false);
});

test('temporary HOME is cleaned after sync and async errors and async success',async()=>{
  let home;assert.throws(()=>withRepairEnvironment({},c=>{home=c.env.HOME;throw new Error('expected failure');}),/expected failure/);assert.equal(fs.existsSync(home),false);
  await assert.rejects(withRepairEnvironment({},async c=>{home=c.env.HOME;await Promise.resolve();throw new Error('async failure');}),/async failure/);assert.equal(fs.existsSync(home),false);
  assert.equal(await withRepairEnvironment({},async c=>{home=c.env.HOME;assert.equal(fs.existsSync(home),true);return 'success';}),'success');assert.equal(fs.existsSync(home),false);
});

test('real repair repetitions preserve ordinary assertions and never emit configured credential values',t=>{
  const secret='synthetic-native-validation-secret',requirements='Addition returns the arithmetic sum.\n';
  const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\n','tddswarm.requirements.md':requirements,'tddswarm.config.json':{runner:[process.execPath,'--test','{files}'],env:{OPENAI_API_KEY:secret,GH_TOKEN:secret,FEATURE_LABEL:'preserved'}},'src/add.js':'export const add=(a,b)=>a-b;','test/add.test.js':"import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {add} from '../src/add.js';test('arithmetic sum',()=>assert.equal(add(2,3),5));test('ordinary label',()=>assert.equal(process.env.FEATURE_LABEL,'preserved'));test('credentials isolated',()=>{assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.GH_TOKEN,undefined);assert.equal(fs.readFileSync(process.env.NPM_CONFIG_USERCONFIG,'utf8'),'')});"});commit(root);
  const staged=stageRepair(root,{files:[{path:'src/add.js',content:'export const add=(a,b)=>a+b;'}],requirements,sourcePaths:['src/add.js'],review:{accepted:true,findings:[],oracle:{independent:true,basis:['Original arithmetic requirements']}}});
  const result=validateRepair(root,staged.candidatePath,{timeoutMs:5000,totalTimeoutMs:30000});assert.equal(result.accepted,true,result.reasons.join(','));assert.equal(result.baseline.length,2);assert.equal(result.candidateRuns.length,2);assert.equal(result.assertionRuns.length,2);
  const serialized=JSON.stringify(result);assert.equal(serialized.includes(secret),false);assert.equal(serialized.includes('"env":'),false);assert.equal(serialized.includes('"config":'),false);
  assert.equal(fs.readFileSync(path.join(staged.directory,'validation.json'),'utf8').includes(secret),false);
});
