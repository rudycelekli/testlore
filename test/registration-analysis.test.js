import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {analyze}=createRequire(import.meta.url)('../src/source-analysis.cjs');

for(const [name,source] of Object.entries({
 namedAlias:`import {register as enable} from 'node:module'; enable('./loader.js',import.meta.url);`,
 hooksAlias:`import {registerHooks as enable} from 'module'; const callback=enable; callback({resolve(){}});`,
 defaultEscape:`import hooks from 'node:module'; const callback=hooks['reg'+'ister']; callback('./loader.js');`,
 namespaceEscape:`import * as hooks from 'node:module'; Reflect.get(hooks,'registerHooks')({});`,
 importEquals:`import hooks = require('node:module'); const callback=hooks.registerHooks; callback({});`,
 commonjsDestructure:`const {register: enable}=require('module'); enable('./loader.js');`,
 commonjsHooks:`const {registerHooks: enable}=require('node:module'); enable({});`,
 commonjsNamespace:`const hooks=require('module'); const callback=hooks.register; callback('./loader.js');`,
 commonjsRest:`const {createRequire,...rest}=require('module'); rest.registerHooks({});`,
 dynamicImport:`const hooks=await import('node:module'); hooks.register('./loader.js');`,
 reexport:`export {register as enable} from 'node:module';`,
 hooksReexport:`export {registerHooks as enable} from 'module';`,
 starReexport:`export * from 'node:module';`,
 namespaceReexport:`export * as hooks from 'node:module';`,
 ordinaryUnknown:`application.register('thing');`,
 elementAccess:`application['register']('thing');`,
 hooksUnknown:`application.registerHooks({});`,
 bareUnknown:`register('thing');`,
 optionalCall:`application.register?.('thing');`
 ,callbackEscape:`const callback=application.register; callback('thing');`
 ,parenthesized:`(application.register)('thing');`
 ,assertion:`(register as Function)('thing');`
}))test(`retains global-registration uncertainty for ${name}`,()=>assert.ok(analyze('source.ts',source).warnings.includes('runtime-registration')));

for(const [name,source] of Object.entries({
 createRequire:`import {createRequire as makeRequire} from 'node:module'; const require=makeRequire(import.meta.url);`,
 createRequireCommonjs:`const {createRequire: makeRequire}=require('node:module'); const require=makeRequire(import.meta.url);`,
 nonloaderReexport:`export {createRequire as makeRequire} from 'node:module';`,
 stringOnly:`const text='application.register(thing)'; // module.registerHooks({})`,
 identifierOnly:`const registerCount=0;`
}))test(`does not invent loader capability for ${name}`,()=>assert.ok(!analyze('source.ts',source).warnings.includes('runtime-registration')));

test('call observations identify literal properties without granting authority or replacing source evidence',()=>{
 const source=`obj['register']('one'); obj.registerHooks({});`;
 const {registrationCalls}=analyze('source.ts',source);
 assert.deepEqual(registrationCalls.map(call=>call.method),['register','registerHooks']);
 assert.deepEqual(registrationCalls.map(call=>source.slice(call.start,call.end)),["obj['register']('one')",'obj.registerHooks({})']);
 assert.ok(registrationCalls.every(call=>!Object.hasOwn(call,'omissionAuthority')));
});
