// Observe read-only filesystem inputs in each test subprocess. This is not a sandbox.
const fs=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {syncBuiltinESMExports}=require('node:module');
const originalRead=fs.readFileSync;
const originalWrite=fs.writeFileSync;
const root=process.env.TDDSWARM_TRACE_ROOT;
const destination=process.env.TDDSWARM_TRACE_FILE;
const observed=new Set();
function track(value){
  try {
    if(value instanceof URL)value=fileURLToPath(value);
    if(Buffer.isBuffer(value))value=value.toString();
    if(typeof value!=='string')return;
    const absolute=path.resolve(value);
    if(root&&absolute.startsWith(root+path.sep)) {
      const relative=path.relative(root,absolute).split(path.sep).join('/');
      if(!relative.split('/').some(x=>['node_modules','.git','.tddswarm'].includes(x)))observed.add(relative);
    }
  }catch{}
}
fs.readFileSync=function(file,...args){track(file);return originalRead.call(this,file,...args);};
const originalAsync=fs.readFile;
fs.readFile=function(file,...args){track(file);return originalAsync.call(this,file,...args);};
const originalStream=fs.createReadStream;
fs.createReadStream=function(file,...args){track(file);return originalStream.call(this,file,...args);};
const promises=fs.promises;const originalPromise=promises.readFile;
promises.readFile=function(file,...args){track(file);return originalPromise.call(this,file,...args);};
const originalOpen=promises.open;
promises.open=function(file,...args){track(file);return originalOpen.call(this,file,...args);};
syncBuiltinESMExports();
process.on('exit',()=>{if(destination)try{originalWrite(`${destination}-${process.pid}.json`,JSON.stringify({schemaVersion:1,files:[...observed].sort()}));}catch{}});
