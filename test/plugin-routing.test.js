import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {plan,run,improve} from '../src/index.js';
import {configurePlugin,checkPlugins,configurePluginsAutomatically} from '../src/plugins.js';
import {createHash} from 'node:crypto';

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function project(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-plugin-routing-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 fs.writeFileSync(path.join(root,'.gitignore'),'.tddswarm/\n');
 // Independent native-engine protocol fixture: reject JS runner invocation and
 // record whether full/shadow correctly widens native project discovery.
 fs.writeFileSync(path.join(root,'native.cjs'),`const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync('.tddswarm/native-calls.jsonl',JSON.stringify(a)+'\\n');if(a[0]==='show'){console.log(JSON.stringify(a.includes('--affected')?['web']:['web','shared']));}else if(a[0]==='run-many'){process.exit(1)}else process.exit(7);`);
 fs.writeFileSync(path.join(root,'tddswarm.config.json'),JSON.stringify({plugins:{nx:{enabled:true,executable:process.execPath,args:['native.cjs']}}}));
 fs.mkdirSync(path.join(root,'.tddswarm'));
 execFileSync('git',['init','-q',root]);
 execFileSync('git',['-C',root,'add','.']);
 execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline']);
 return root;
}
test('ordinary plan/run APIs dispatch an enabled native plugin and preserve completed failures',t=>{
 const root=project(t),selection=plan(root,{base:'HEAD'});
 assert.equal(selection.adapter,'nx');assert.deepEqual(selection.targets,['web']);assert.equal(selection.complete,true);
 const report=run(root,{base:'HEAD'});
 assert.equal(report.adapter,'nx');assert.equal(report.complete,true);assert.equal(report.exitCode,1);assert.equal(report.executed,true);
 assert.deepEqual(report.plan.targets,['web']);assert.ok(report.command.includes('--projects=web'));
 assert.equal(report.tests,undefined); // Native project scope never becomes invented per-case evidence.
 const full=run(root,{base:'HEAD',shadow:true});
 assert.deepEqual(full.plan.targets,['web','shared']);assert.equal(full.shadow,true);
 assert.throws(()=>run(root,{changed:['src/app.js']}),/diagnostic only/);
});
test('ordinary CLI native plugin execution preserves failure status and renders native scope',t=>{
 const root=project(t);
 const result=spawnSync(process.execPath,[cli,'run','--root',root,'--base','HEAD'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stdout,/nx.*native targets/);assert.match(result.stdout,/Runner exited 1/);assert.match(result.stdout,/no individual-case comparison/);
 const json=spawnSync(process.execPath,[cli,'run','--root',root,'--base','HEAD','--json'],{encoding:'utf8'});
 assert.equal(json.status,1);assert.equal(JSON.parse(json.stdout).delegated,true);
});
test('all builtins can be enabled without duplicate execution or automatic generation/retrieval',t=>{
 const root=project(t),file=path.join(root,'tddswarm.config.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));
 config.executionPlugin='nx';
 for(const id of ['pytest-testmon','bazel','agentic-qe','c8','stryker','ruvector'])config.plugins[id]={enabled:true};
 fs.writeFileSync(file,JSON.stringify(config));
 const report=run(root,{base:'HEAD'});
 assert.equal(report.adapter,'nx');assert.equal(report.exitCode,1);assert.equal(report.complete,true);
 const calls=fs.readFileSync(path.join(root,'.tddswarm/native-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,2);assert.equal(calls[0][0],'show');assert.equal(calls[1][0],'run-many');
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/learning/ruvector')),false);
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/candidates')),false);
});
test('AQE health checks find the same project-local executable used by generation',t=>{
 const root=project(t),directory=path.join(root,'node_modules/.bin');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'aqe'),'#!/usr/bin/env node\nconsole.log("generate --framework --format --output");\n',{mode:0o755});
 configurePlugin(root,'agentic-qe',{enabled:true});
 const health=checkPlugins(root,{id:'agentic-qe'});
 assert.equal(health.exitCode,0);assert.equal(health.plugins[0].available,true);
 assert.equal(health.plugins[0].command[0],path.join(directory,'aqe'));assert.equal(health.plugins[0].measured,false);
});
test('native backend improvement refuses unsupported candidate-case validation before creating branches',async t=>{
 const root=project(t),before=execFileSync('git',['-C',root,'branch','--format=%(refname)'],{encoding:'utf8'});
 await assert.rejects(improve(root),/individual-case validation/);
 assert.equal(execFileSync('git',['-C',root,'branch','--format=%(refname)'],{encoding:'utf8'}),before);
 assert.equal(fs.existsSync(path.join(root,'.tddswarm/improvement')),false);
});

test('automatic setup validates the whole plan before one configuration write and retains explicit choices',t=>{
 const root=project(t),file=path.join(root,'tddswarm.config.json');
 const original=fs.readFileSync(file,'utf8'),configHash=createHash('sha256').update(original).digest('hex');
 assert.throws(()=>configurePluginsAutomatically(root,{configHash,blocked:true,applicable:[{id:'c8'}]}),/blocked/);
 assert.equal(fs.readFileSync(file,'utf8'),original);
 assert.throws(()=>configurePluginsAutomatically(root,{configHash,applicable:[{id:'c8'},{id:'ruvector',settings:{dimensions:3}}]}),/dimensions/);
 assert.equal(fs.readFileSync(file,'utf8'),original);
 assert.throws(()=>configurePluginsAutomatically(root,{configHash,applicable:[{id:'nx'}]}),/explicit plugin/);
 assert.equal(fs.readFileSync(file,'utf8'),original);
 const result=configurePluginsAutomatically(root,{configHash,applicable:[{id:'c8'},{id:'ruvector'}]});
 assert.deepEqual(result.applied,['c8','ruvector']);assert.equal(result.changed,true);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).plugins.nx,JSON.parse(original).plugins.nx);
 assert.throws(()=>configurePluginsAutomatically(root,{configHash,applicable:[]}),/changed after inspection/);
});
test('CLI automatic setup preserves disabled choices, enables an installed complementary role, and never probes it',t=>{
 const root=project(t),file=path.join(root,'tddswarm.config.json'),config=JSON.parse(fs.readFileSync(file));
 config.plugins.c8={enabled:false};fs.writeFileSync(file,JSON.stringify(config));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module',devDependencies:{c8:'12.0.0','@stryker-mutator/core':'10.0.0'}}));
 for(const [name,bin] of [['c8','c8'],['@stryker-mutator/core','stryker']]){
  const packageRoot=path.join(root,'node_modules',name);fs.mkdirSync(packageRoot,{recursive:true});fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({name}));
  fs.mkdirSync(path.join(root,'node_modules/.bin'),{recursive:true});
  fs.writeFileSync(path.join(root,'node_modules/.bin',bin),'#!/usr/bin/env node\nrequire("fs").writeFileSync("PROBED","unexpected");\n',{mode:0o755});
 }
 const original=fs.readFileSync(file,'utf8');
 const inspect=spawnSync(process.execPath,[cli,'plugins','--recommend','--root',root,'--json'],{encoding:'utf8'});
 assert.equal(inspect.status,0,inspect.stderr);assert.equal(fs.readFileSync(file,'utf8'),original);
 const automatic=spawnSync(process.execPath,[cli,'plugins','--auto','--root',root,'--json'],{encoding:'utf8'});
 assert.equal(automatic.status,0,automatic.stderr);assert.deepEqual(JSON.parse(automatic.stdout).applied,['stryker']);
 const updated=JSON.parse(fs.readFileSync(file));assert.equal(updated.plugins.c8.enabled,false);assert.equal(updated.plugins.stryker.enabled,true);assert.deepEqual(updated.plugins.nx,config.plugins.nx);
 assert.equal(fs.existsSync(path.join(root,'PROBED')),false);
 const again=spawnSync(process.execPath,[cli,'plugins','--auto','--root',root,'--json'],{encoding:'utf8'});
 assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).changed,false);
});
