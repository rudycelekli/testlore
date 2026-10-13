// Portable Node assertion harness. Challenge files are maintainer inputs,
// never generated proposals. This is trusted execution, not an OS sandbox.
'use strict';
const native = require('assert');
const apply=Reflect.apply;
const mapGet=Function.prototype.call.bind(Map.prototype.get);
const mapHas=Function.prototype.call.bind(Map.prototype.has);
const mapSet=Function.prototype.call.bind(Map.prototype.set);
const promiseThen=Function.prototype.call.bind(Promise.prototype.then);
const promiseResolve=Promise.resolve.bind(Promise);
const arrayPush=Function.prototype.call.bind(Array.prototype.push);
const pending=[];
let assertions = 0;
function invoke(target,receiver,args) {
 assertions++;
 const result=apply(target,receiver,args);
 if(result&&typeof result.then==='function')arrayPush(pending,promiseThen(promiseResolve(result),()=>({passed:true}),error=>({passed:false,error})));
 return result;
}
const proxies=new Map();
function track(subject) {
 if(mapHas(proxies,subject))return mapGet(proxies,subject);
 const values=new Map(Object.getOwnPropertyNames(subject).map(key=>[key,subject[key]]));
 const proxy=new Proxy(subject, {
  apply(target, receiver, args) { return invoke(target,receiver,args); },
  get(target, key) {
    const value = mapGet(values,key);
    if (key === 'strict') return track(value);
    if (typeof value !== 'function' || key === 'AssertionError') return value;
    return (...args) => invoke(value,undefined,args);
  }
 });mapSet(proxies,subject,proxy);
 if(mapGet(values,'strict'))track(mapGet(values,'strict'));
 return proxy;
}
const tracked=track(native);
const id = process.argv[3];
function failed(error) {
 process.stdout.write(JSON.stringify({id, status: 'failed', assertions, error: {name: String(error && error.name || 'Error').slice(0,80)}}) + '\n');
 process.exitCode = 1;
}
Promise.resolve().then(() => {
  const challenge = require(process.argv[2]);
  if (typeof challenge !== 'function') throw new Error('Challenge must export a function');
  return challenge({assert: tracked, root: process.cwd()});
}).then(async () => {
 try {
  // Calling an async assertion is not evidence that it completed. Track even
  // assertions the owner forgot to await; an unresolved assertion emits no pass.
  let cursor=0;
  while(cursor<pending.length){const outcome=await pending[cursor++];if(!outcome.passed)throw outcome.error;}
  if (!assertions) throw new Error('Challenge executed no tracked assertions');
  process.stdout.write(JSON.stringify({id, status: 'passed', assertions}) + '\n');
 }catch(error){failed(error);}
}, failed).catch(() => { process.exitCode = 1; });
