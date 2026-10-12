// Portable Node assertion harness. Challenge files are maintainer inputs,
// never generated proposals. This is trusted execution, not an OS sandbox.
'use strict';
const native = require('assert');
const apply=Reflect.apply;
const mapGet=Function.prototype.call.bind(Map.prototype.get);
const mapHas=Function.prototype.call.bind(Map.prototype.has);
const mapSet=Function.prototype.call.bind(Map.prototype.set);
let assertions = 0;
const proxies=new Map();
function track(subject) {
 if(mapHas(proxies,subject))return mapGet(proxies,subject);
 const values=new Map(Object.getOwnPropertyNames(subject).map(key=>[key,subject[key]]));
 const proxy=new Proxy(subject, {
  apply(target, receiver, args) { assertions++; return apply(target, receiver, args); },
  get(target, key) {
    const value = mapGet(values,key);
    if (key === 'strict') return track(value);
    if (typeof value !== 'function' || key === 'AssertionError') return value;
    return (...args) => { assertions++; return value(...args); };
  }
 });mapSet(proxies,subject,proxy);
 if(mapGet(values,'strict'))track(mapGet(values,'strict'));
 return proxy;
}
const tracked=track(native);
const id = process.argv[3];
Promise.resolve().then(() => {
  const challenge = require(process.argv[2]);
  if (typeof challenge !== 'function') throw new Error('Challenge must export a function');
  return challenge({assert: tracked, root: process.cwd()});
}).then(() => {
  if (!assertions) throw new Error('Challenge executed no tracked assertions');
  process.stdout.write(JSON.stringify({id, status: 'passed', assertions}) + '\n');
}, error => {
  process.stdout.write(JSON.stringify({id, status: 'failed', assertions, error: {name: String(error && error.name || 'Error').slice(0,80)}}) + '\n');
  process.exitCode = 1;
}).catch(() => { process.exitCode = 1; });
