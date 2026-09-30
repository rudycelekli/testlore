import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture,commit,write} from './helpers.js';
import {executeNativeRelated,execute,discover} from '../src/execution.js';
import {run} from '../src/runner.js';
const tools=fileURLToPath(new URL('../node_modules',import.meta.url));
test('actual Vitest related comparison measures its native selection and reveals declared runtime asset faults',t=>{
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules\n','src/a.js':'export const a=1;','public/copy.json':'{"heading":"Welcome"}',
 'a.test.js':"import {test,expect} from 'vitest';import fs from 'node:fs';import {a} from './src/a.js';test('independent heading',()=>{expect(a).toBe(1);expect(JSON.parse(fs.readFileSync(new URL('./public/copy.json',import.meta.url))).heading).toBe('Welcome')});",
 'b.test.js':"import {test,expect} from 'vitest';test('unrelated',()=>expect(2).toBe(2));",
 'tddswarm.config.json':{adapter:'vitest',discovery:'native',runner:[process.execPath,path.join(tools,'vitest/vitest.mjs'),'run','{files}'],dependencies:{'a.test.js':['public/copy.json']}}});
 fs.symlinkSync(tools,path.join(root,'node_modules'));commit(root);
 const config=JSON.parse(fs.readFileSync(path.join(root,'tddswarm.config.json'))),baseline=executeNativeRelated(root,['src/a.js'],config,{capture:true});assert.equal(baseline.complete,true,JSON.stringify(baseline));assert.equal(baseline.tests.length,1);assert.equal(baseline.exitCode,0);
 write(root,'public/copy.json','{"heading":"Wrong"}');
 const full=execute(root,discover(root,config).files,config,{capture:true}),related=executeNativeRelated(root,['public/copy.json'],config,{capture:true}),routed=run(root,{capture:true,selective:true});
 assert.equal(full.complete,true);assert.equal(full.tests.filter(test=>test.status==='failed').length,1);assert.equal(related.complete,true,JSON.stringify(related));assert.equal(related.tests.length,0);assert.equal(routed.complete,true);assert.equal(routed.exitCode,1);assert.deepEqual(routed.tests.filter(test=>test.status==='failed').map(test=>test.id),full.tests.filter(test=>test.status==='failed').map(test=>test.id));
});
