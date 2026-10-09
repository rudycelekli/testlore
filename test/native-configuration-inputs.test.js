import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixture,write,commit} from './helpers.js';
import {plan} from '../src/selector.js';
import {runUnifiedNative,compareSubsetCases} from '../src/runner.js';
import {execute} from '../src/execution.js';
const vitest=process.env.TDDSWARM_VITEST_BIN||path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
const source=`import {realpathSync} from 'node:fs';import {tmpdir} from 'node:os';const temp=realpathSync(tmpdir());export default {test:{include:['checks/*.check.js'],env:{TMPDIR:temp},maxWorkers:1}};`;
function project(t){
 const config={adapter:'vitest',discovery:'native',runner:[process.execPath,vitest,'run','--config','vitest.config.mjs','{files}'],configurationInputs:[{file:'vitest.config.mjs',kind:'canonical-temp-directory',sourceSha256:createHash('sha256').update(source).digest('hex')}]};
 const root=fixture(t,{'package.json':{type:'module'},'.gitignore':'.tddswarm/\nnode_modules/\n','tddswarm.config.json':config,'vitest.config.mjs':source,'src/a.js':'export default 1;','src/b.js':'export default 1;','checks/a.check.js':`import {test,expect} from 'vitest';import a from '../src/a.js';test('independent first subject',()=>expect(a).toBe(1));`,'checks/b.check.js':`import {test,expect} from 'vitest';import b from '../src/b.js';test('independent second subject',()=>expect(b).toBe(1));`});
 fs.symlinkSync(path.dirname(path.dirname(vitest)),path.join(root,'node_modules'),'dir');commit(root);return {root,config};
}
test('admitted physical configuration input permits a precise subset preserving an independent regression',async t=>{
 const {root,config}=project(t);write(root,'src/a.js','export default 2;');
 const selected=await runUnifiedNative(root,{selective:true,capture:true});
 assert.equal(selected.complete,true,selected.error);assert.equal(selected.exitCode,1);assert.equal(selected.unifiedNative.used,true);
 assert.deepEqual(selected.plan.selected,['checks/a.check.js']);assert.equal(selected.plan.configurationInputs.observations.length,1);
 const full=execute(root,['checks/a.check.js','checks/b.check.js'],config,{capture:true});assert.equal(full.complete,true);assert.equal(full.exitCode,1);assert.equal(compareSubsetCases(full,selected,selected.executedTests).complete,true);
 assert.deepEqual(selected.tests.filter(row=>row.status==='failed').map(row=>row.id),full.tests.filter(row=>row.status==='failed').map(row=>row.id));
});
test('absent or stale approval retains full fallback rather than suppressing configuration fs uncertainty',t=>{
 const {root,config}=project(t);write(root,'src/a.js','export default 2;');
 delete config.configurationInputs;write(root,'tddswarm.config.json',config);assert.equal(plan(root,{changed:['src/a.js']}).mode,'full');
 config.configurationInputs=[{file:'vitest.config.mjs',kind:'canonical-temp-directory',sourceSha256:'0'.repeat(64)}];write(root,'tddswarm.config.json',config);const invalid=plan(root,{changed:['src/a.js']});assert.equal(invalid.mode,'full');assert.ok(invalid.warnings.some(w=>w.reason==='configuration-input-unavailable'));
});
