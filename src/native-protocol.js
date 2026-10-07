import fs from 'node:fs';
import {TextDecoder} from 'node:util';
export const NATIVE_FRAME_LIMIT=32*1024*1024;
const utf8=new TextDecoder('utf-8',{fatal:true});
function boundedLimit(limit){if(!Number.isInteger(limit)||limit<1||limit>NATIVE_FRAME_LIMIT)throw new Error('Invalid unified native byte ceiling');}
export function encodeNativeFrame(value,limit=NATIVE_FRAME_LIMIT) {
 boundedLimit(limit);
 const body=Buffer.from(JSON.stringify(value),'utf8');
 if(!body.length||body.length>limit)throw new Error('Unified native frame exceeds byte limit');
 const header=Buffer.alloc(4);header.writeUInt32BE(body.length);return Buffer.concat([header,body]);
}
/** Validate the four-byte length BEFORE allocating a body or decoding JSON. */
export function nativeFrameReader({onFrame,onError,limit=NATIVE_FRAME_LIMIT}) {
 boundedLimit(limit);
 const header=Buffer.alloc(4);let headerBytes=0,body=null,bodyBytes=0,failed=false;
 const fail=error=>{if(failed)return;failed=true;body=null;onError(error);};
 return {
  push(chunk){if(failed)return;let offset=0;
   try {while(offset<chunk.length){
    if(!body){const count=Math.min(4-headerBytes,chunk.length-offset);chunk.copy(header,headerBytes,offset,offset+count);headerBytes+=count;offset+=count;
     if(headerBytes<4)continue;const length=header.readUInt32BE(0);if(!length||length>limit)throw new Error('Unified native frame exceeds declared byte limit');body=Buffer.alloc(length);bodyBytes=0;
    }
    const count=Math.min(body.length-bodyBytes,chunk.length-offset);chunk.copy(body,bodyBytes,offset,offset+count);bodyBytes+=count;offset+=count;
    if(bodyBytes===body.length){const value=JSON.parse(utf8.decode(body));body=null;bodyBytes=0;headerBytes=0;onFrame(value);}
   }}catch(error){fail(error);}
  },
  end(){if(!failed&&(headerBytes||body))fail(new Error('Truncated unified native frame'));}
 };
}
/** No path-following or unbounded readFile allocation, including FIFOs and growth. */
export function readNativeJson(file,limit=NATIVE_FRAME_LIMIT) {
 boundedLimit(limit);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try {
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size<1||before.size>limit)throw new Error('Unbounded or nonregular unified native report');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const read=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!read)throw new Error('Unified native report truncated during read');offset+=read;}
  const after=fs.fstatSync(fd),named=fs.lstatSync(file);
  if(!named.isFile()||named.dev!==before.dev||named.ino!==before.ino||after.size!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('Unified native report changed during read');
  return JSON.parse(utf8.decode(bytes));
 }finally{fs.closeSync(fd);}
}
