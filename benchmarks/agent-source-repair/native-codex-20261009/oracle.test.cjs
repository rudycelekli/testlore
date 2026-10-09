const test=require('node:test');const assert=require('assert');const isNumber=require('./');
for(const [name,num] of [['zero',0],['one',1],['negative',-1],['numeric-string','1']])test(name,()=>{assert.equal(isNumber(num),true);});
for(const [name,num] of [['empty',''],['null',null],['space-only','   '],['control-whitespace','\r\n\t']])test(name,()=>{assert.equal(isNumber(num),false);});
