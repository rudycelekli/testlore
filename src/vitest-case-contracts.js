// Explicit experimental registration evidence. This never authorizes omissions.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {safePath} from './files.js';
export const vitestCaseHash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const E2E_LOCATOR_FILE='tests/unit/locator-wait-for.test.ts';
export const E2E_LOCATOR_REVISION='0ddea76a7091ac8768e0ced2a9926b37e72e9497';
export const E2E_LOCATOR_SOURCE_SHA256='045a772119c897928ad3d14091732e3cee50bf6e9a3315b29612e0bb543e49c1';
export const E2E_LOCATOR_TABLE=String.raw`[
    ['attached', [], [hiddenBanner]],
    ['detached', [hiddenBanner], []],
    ['visible', [hiddenBanner], [banner]],
    ['hidden', [banner], [hiddenBanner]],
    ['hidden', [banner], []],
  ] as const`;
const TITLE='waits for %s until the node changes after 1200 ms';
const SHA=/^[a-f0-9]{64}$/;
function expectedLocatorRows(){const banner={ref:{id:'banner',revision:''},role:'alert',name:'Saved',testId:'banner'},hiddenBanner={...banner,states:{hidden:true}};return [['attached',[],[hiddenBanner]],['detached',[hiddenBanner],[]],['visible',[hiddenBanner],[banner]],['hidden',[banner],[hiddenBanner]],['hidden',[banner],[]]];}

/** Plain bounded data only. Never invoke getters, toJSON or opaque serialization. */
export function vitestParameterDigest(value){
 const active=new Set();let nodes=0;
 function plain(item,depth=0){
  if(depth>10||++nodes>1024)throw Error('Parameter structure exceeds registration budget');
  if(item===null||typeof item==='boolean'||typeof item==='string'&&item.length<=4096)return item;
  if(typeof item==='number'&&Number.isFinite(item)&&!Object.is(item,-0))return item;
  if(!item||typeof item!=='object'||types.isProxy(item)||active.has(item)||Object.getOwnPropertySymbols(item).length)throw Error('Opaque, cyclic or unsupported registration parameter');
  const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('Nonplain registration parameter');
  active.add(item);const descriptors=Object.getOwnPropertyDescriptors(item);let output;
  if(array){
   if(item.length>128||Object.keys(descriptors).some(key=>key!=='length'&&!/^(?:0|[1-9]\d*)$/.test(key)))throw Error('Unsupported registration array');
   output=[];for(let i=0;i<item.length;i++){const d=descriptors[i];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('Accessor or sparse registration array');output.push(plain(d.value,depth+1));}
  }else{
   output=Object.create(null);for(const key of Object.keys(descriptors).sort()){const d=descriptors[key];if(!d.enumerable||!Object.hasOwn(d,'value')||['__proto__','constructor','prototype'].includes(key))throw Error('Accessor or unsupported registration property');output[key]=plain(d.value,depth+1);}
  }
  active.delete(item);return output;
 }
 const serialized=JSON.stringify(plain(value));if(Buffer.byteLength(serialized)>16384)throw Error('Parameter bytes exceed registration budget');return vitestCaseHash(serialized);
}

export function readVitestCaseSource(root,file){
 const full=safePath(root,file),fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size>1024*1024)throw Error('Case source must be bounded regular bytes');const bytes=Buffer.alloc(before.size+1);let offset=0,n;while(offset<bytes.length&&(n=fs.readSync(fd,bytes,offset,bytes.length-offset,null)))offset+=n;const after=fs.fstatSync(fd),named=fs.lstatSync(full);if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.dev!==before.dev||named.ino!==before.ino||!named.isFile())throw Error('Case source changed during capture');return bytes.subarray(0,offset);}finally{fs.closeSync(fd);}
}

/** Explicit reviewed producer contract, not an arbitrary declaration of identity. */
export function e2eLocatorRegistrationContract(root,{upstreamRevision,vitestVersion}={}){
 if(upstreamRevision!==E2E_LOCATOR_REVISION||!['5.0.1','5.0.2'].includes(vitestVersion))throw Error('Pinned reviewed e2e/Vitest profile required');
 const source=readVitestCaseSource(root,E2E_LOCATOR_FILE).toString('utf8'),declaration='it.each('+E2E_LOCATOR_TABLE+')';
 if(vitestCaseHash(source)!==E2E_LOCATOR_SOURCE_SHA256||source.split(declaration).length!==2)throw Error('Reviewed exact e2e source or declaration changed');
 const rows=expectedLocatorRows();
 const contract={schemaVersion:1,kind:'reviewed-e2e-locator-runtime-registration',file:E2E_LOCATOR_FILE,sourceSha256:E2E_LOCATOR_SOURCE_SHA256,upstreamRevision,vitestVersion,title:TITLE,declarationSha256:vitestCaseHash(declaration),declarationLine:source.slice(0,source.indexOf(declaration)).split('\n').length,rows:rows.map((row,index)=>({inputSha256:vitestParameterDigest(row),declarationRowSha256:vitestCaseHash(E2E_LOCATOR_TABLE.split('\n')[index+1])})),omissionAuthority:false,inputEquivalenceClaim:false};
 contract.rows=contract.rows.map(row=>({...row,registrationId:vitestCaseHash({file:contract.file,sourceSha256:contract.sourceSha256,declarationSha256:contract.declarationSha256,...row})}));
 return contract;
}

function validateContract(contract){
 if(contract?.schemaVersion!==1||contract.kind!=='reviewed-e2e-locator-runtime-registration'||contract.file!==E2E_LOCATOR_FILE||contract.sourceSha256!==E2E_LOCATOR_SOURCE_SHA256||contract.upstreamRevision!==E2E_LOCATOR_REVISION||!['5.0.1','5.0.2'].includes(contract.vitestVersion)||contract.title!==TITLE||contract.omissionAuthority!==false||contract.inputEquivalenceClaim!==false||contract.declarationLine!==52||contract.declarationSha256!==vitestCaseHash('it.each('+E2E_LOCATOR_TABLE+')')||!Array.isArray(contract.rows)||contract.rows.length!==5||contract.rows.some(row=>!SHA.test(row.inputSha256)||!SHA.test(row.declarationRowSha256)||!SHA.test(row.registrationId))||new Set(contract.rows.map(row=>row.registrationId)).size!==5)throw Error('Invalid reviewed registration contract');
 for(const [index,row]of expectedLocatorRows().entries()){const expected={inputSha256:vitestParameterDigest(row),declarationRowSha256:vitestCaseHash(E2E_LOCATOR_TABLE.split('\n')[index+1])};expected.registrationId=vitestCaseHash({file:contract.file,sourceSha256:contract.sourceSha256,declarationSha256:contract.declarationSha256,...expected});if(JSON.stringify(contract.rows[index])!==JSON.stringify(expected))throw Error('Reviewed registration row contract differs');}
}

/** Preserve table, callback, order and raw title. Invalid data retains a native case with a failing evidence guard. */
export function registerReviewedE2ELocatorEach(it,table,contract){
 validateContract(contract);contract=structuredClone(contract);
 return (title,callback)=>{
  if(title!==contract.title||typeof callback!=='function'||!Array.isArray(table))throw Error('Reviewed declaration changed');
  // Unknown extra/missing rows still register as native cases; incomplete evidence
  // cannot disappear simply because a serializer or contract rejects its input.
  const countMismatch=table.length!==contract.rows.length;
  for(let index=0;index<table.length;index++){
   const row=table[index],expected=contract.rows[index];let inputSha256=null,error=null;
   try{inputSha256=vitestParameterDigest(row);if(countMismatch||!expected||inputSha256!==expected.inputSha256)throw Error('Actual registration inputs/order changed');}catch(cause){error=cause.message;}
   const registration={contractHash:vitestCaseHash(contract),registrationId:expected?.registrationId||null,inputSha256,sourceSha256:contract.sourceSha256,valid:error===null,error};
   // The reviewed title has one %s and no index expansion; registering each
   // original row separately preserves its rendered title and argument values.
   it.each([row])(title,{meta:{testloreVitestRegistration:registration}},async (...args)=>{
    if(error)throw Error('TestLore registration evidence rejected: '+error);
    if(vitestParameterDigest(args)!==inputSha256)throw Error('Actual parameters changed before native test execution');
    return callback(...args);
   });
  }
 };
}

/** Exact-source, explicit opt-in Vite overlay. Upstream disk bytes/body/title remain unchanged. */
export function createE2ELocatorRegistrationPlugin(root,contract){
 validateContract(contract);const logicalRoot=path.resolve(root);root=fs.realpathSync(root);const target=safePath(root,contract.file).replaceAll('\\','/'),logicalTarget=path.join(logicalRoot,contract.file).replaceAll('\\','/'),helper=fileURLToPath(import.meta.url).replaceAll('\\','/');
 return {name:'testlore-reviewed-e2e-locator-registration',enforce:'pre',transform(source,id){
  const name=id.split('?')[0].replaceAll('\\','/');if(name!==target&&name!==logicalTarget)return;
  const declaration='it.each('+E2E_LOCATOR_TABLE+')';
  if(vitestCaseHash(source)!==contract.sourceSha256||source.split(declaration).length!==2)throw Error('Reviewed registration source drift');
  const replacement='__testloreReviewedEach(it,'+E2E_LOCATOR_TABLE+','+JSON.stringify(contract)+')';
  return {code:'import {registerReviewedE2ELocatorEach as __testloreReviewedEach} from '+JSON.stringify(helper)+';\n'+source.replace(declaration,replacement),map:null};
 }};
}

export function validateVitestRegistration(record,contract){
 validateContract(contract);const expected=contract.rows.find(row=>row.registrationId===record?.registrationId);
 return !!expected&&record.valid===true&&record.error===null&&record.contractHash===vitestCaseHash(contract)&&record.sourceSha256===contract.sourceSha256&&record.inputSha256===expected.inputSha256;
}
