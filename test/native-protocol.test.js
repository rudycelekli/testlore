import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {encodeNativeFrame,nativeFrameReader,readNativeJson} from '../src/native-protocol.js';import {fixture,write} from './helpers.js';
test('length prefix rejects oversized frames before JSON decode/body allocation',()=>{
 const values=[],errors=[],reader=nativeFrameReader({limit:64,onFrame:value=>values.push(value),onError:error=>errors.push(error)}),header=Buffer.alloc(4);header.writeUInt32BE(0xffffffff);
 reader.push(header.subarray(0,2));assert.equal(errors.length,0);reader.push(header.subarray(2));reader.push(Buffer.from('not JSON'));assert.equal(errors.length,1);assert.match(errors[0].message,/declared byte limit/);assert.deepEqual(values,[]);
});
test('fragmented and consecutive bounded frames retain strict UTF8 and JSON',()=>{
 const values=[],errors=[],reader=nativeFrameReader({onFrame:value=>values.push(value),onError:error=>errors.push(error)}),frame=Buffer.concat([encodeNativeFrame({phase:'planned',title:'café'}),encodeNativeFrame({phase:'executed'})]);
 for(let i=0;i<frame.length;i+=3)reader.push(frame.subarray(i,i+3));reader.end();assert.equal(errors.length,0);assert.deepEqual(values,[{phase:'planned',title:'café'},{phase:'executed'}]);
 for(const bytes of [Buffer.from([0,0,0,1,255]),Buffer.from([0,0,0,3,123])]){const problems=[],parser=nativeFrameReader({onFrame:()=>assert.fail('Invalid frame accepted'),onError:error=>problems.push(error)});parser.push(bytes);parser.end();assert.equal(problems.length,1);}
});
test('descriptor-bounded reports reject symlinks, FIFOs, sparse oversize and invalid UTF8',t=>{
 const root=fixture(t,{'okay.json':{pass:true}});assert.deepEqual(readNativeJson(path.join(root,'okay.json'),64),{pass:true});
 fs.symlinkSync(path.join(root,'okay.json'),path.join(root,'linked.json'));assert.throws(()=>readNativeJson(path.join(root,'linked.json')),/ELOOP|symbolic/);
 const huge=path.join(root,'huge.json');fs.writeFileSync(huge,'');fs.truncateSync(huge,1024*1024*1024);assert.throws(()=>readNativeJson(huge),/Unbounded/);
 write(root,'utf8.json',Buffer.from([255]).toString('binary'));fs.writeFileSync(path.join(root,'utf8.json'),Buffer.from([255]));assert.throws(()=>readNativeJson(path.join(root,'utf8.json')),/encoded data|encoding/);
 if(process.platform!=='win32'){const fifo=path.join(root,'fifo.json');execFileSync('mkfifo',[fifo]);assert.throws(()=>readNativeJson(fifo),/nonregular/);}
});
test('report growth and same-name replacement during descriptor reads invalidate results',t=>{
 const root=fixture(t,{'value.json':{pass:true}}),file=path.join(root,'value.json'),original=fs.readSync;
 for(const change of [()=>fs.appendFileSync(file,' '),()=>{fs.renameSync(file,file+'.old');fs.writeFileSync(file,'{"pass":true}');}]){
  fs.writeFileSync(file,'{"pass":true}');let changed=false;fs.readSync=(...args)=>{const result=original(...args);if(!changed){changed=true;change();}return result;};
  try{assert.throws(()=>readNativeJson(file),/changed during read/);}finally{fs.readSync=original;}
 }
});
