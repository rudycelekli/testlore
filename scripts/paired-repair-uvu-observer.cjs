// Passive registration and assertion-outcome observer for exactly uvu 0.3.3.
// Original handlers, assertions and CLI execution remain unchanged.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
if(/(?:\.bin\/uvu|uvu\/bin\.js)$/.test(process.argv[1]||'')){
 const root=process.cwd(),pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules/uvu/package.json')));
 if(pkg.version!=='0.3.3')throw Error('Observer only qualifies uvu 0.3.3');
 const uvu=require(path.join(root,'node_modules/uvu')),original=uvu.suite,rows=[],errors=[];
 process.on('uncaughtExceptionMonitor',error=>{if(errors.length<32)errors.push({kind:'uncaught-exception',name:String(error.name).slice(0,64),message:String(error.message).slice(0,2048)});});
 uvu.suite=function(name,state){
  const suite=original(name,state);
  const registered=function(title,handler){
   const file='test/'+uvu.QUEUE[globalThis.UVU_INDEX][0],frames=new Error().stack.split('\n');
   const frame=frames.find(line=>line.includes(root+'/test/suites/')&&/:[0-9]+:[0-9]+\)?$/.test(line));
   if(!frame)throw Error('Original registration source location unavailable');
   const found=/([^ ()]+):([0-9]+):([0-9]+)\)?$/.exec(frame),registrationFile=path.relative(root,found[1]);
   if(!/^test\/suites\/[a-z]+\.js$/.test(registrationFile))throw Error('Unsupported registration source');
   const registration={file:registrationFile,line:Number(found[2]),column:Number(found[3]),sha256:crypto.createHash('sha256').update(fs.readFileSync(found[1])).digest('hex')};
   const identity=JSON.stringify([file,name,title,registration]);
   if(rows.some(row=>row.identity===identity)||typeof handler!=='function'||rows.length>=1000)throw Error('Ambiguous or oversized registration');
   const row={identity,file,name:name+' > '+title,registration,id:crypto.createHash('sha256').update(identity).digest('hex'),status:'registered'};rows.push(row);
   return suite(title,async function(){
    try{await handler.apply(this,arguments);row.status='passed';}
    catch(error){row.status='failed';row.error={name:error.name,message:String(error.message).slice(0,2048),operator:error.operator||null};throw error;}
   });
  };
  for(const key of ['before','after','run'])registered[key]=suite[key];
  registered.only=registered.skip=function(){errors.push('Selective or skipped registration');throw Error('Observer rejects selective registration');};
  return registered;
 };
 process.on('exit',code=>{
  const target=process.env.TESTLORE_UVU_RECEIPT;
  if(!target||!path.isAbsolute(target))throw Error('Absolute observer output required');
  fs.writeFileSync(target,JSON.stringify({schemaVersion:1,kind:'uvu-0.3.3-passive-outcomes',exitCode:code,tests:rows.map(({identity,...row})=>row),errors}),{flag:'wx',mode:0o600});
 });
}
