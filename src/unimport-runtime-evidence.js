// Original unimport qualification facts. This capture grants no runtime or
// omission authority; the live native observer must separately admit its context.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {captureNativeVitestCases,assertNativeVitestCases} from './native-vitest-cases.js';
import {UNIMPORT_FACTORY_REVISION,unimportFactoryObserverConfigSource} from './vitest-case-contracts.js';
const hash=bytes=>createHash('sha256').update(typeof bytes==='object'&&!Buffer.isBuffer(bytes)?JSON.stringify(bytes):bytes).digest('hex');
const installedSeals=new WeakMap(),evidenceSeals=new WeakMap();
const fingerprint=stat=>Object.fromEntries(['dev','ino','mode','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]));
const directoryFingerprint=stat=>Object.fromEntries(['dev','ino','mode'].map(key=>[key,String(stat[key])]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const asset='playground/composables/comma-separated.ts';
const safe=file=>typeof file==='string'&&file.length>0&&!path.isAbsolute(file)&&!/[\\\0\r\n]/.test(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..');
const git=(root,args,input)=>execFileSync('git',['-C',root,...args],{input,env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},maxBuffer:40*1024*1024,timeout:15000});
function read(root,file,{maxBytes=32*1024*1024}={}){
 if(!safe(file))throw Error('Invalid runtime evidence path');const full=path.resolve(root,file),stat=fs.lstatSync(full);
 if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(full)!==full||stat.size>maxBytes)throw Error('Runtime evidence input is noncanonical or exceeds bound: '+file);
 const bytes=fs.readFileSync(full),after=fs.lstatSync(full);if(bytes.length!==stat.size||stat.ino!==after.ino||stat.dev!==after.dev||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs)throw Error('Runtime evidence input changed during capture');return bytes;
}
/** Bound actual installed bytes including native binaries. Symlinks are recorded,
 * never followed, and cannot escape the reviewed installation root. */
export function captureInstalledUnimportInputs(root,{maxEntries=100000,maxBytes=1536*1024**2}={}){
 root=fs.realpathSync(root);const rows=[],directories=[],states=new Map();let bytes=0;const started=performance.now();
 function walk(relative){if(performance.now()-started>30000||states.size>=maxEntries)throw Error('Installed runtime closure budget exceeded');const full=path.join(root,relative),stat=fs.lstatSync(full,{bigint:true}),before=fingerprint(stat);
  if(stat.isSymbolicLink()){
   const target=fs.readlinkSync(full),resolved=fs.realpathSync(full);if(resolved!==root&&!resolved.startsWith(root+path.sep))throw Error('Installed runtime symlink escapes reviewed root');const canonicalTarget=path.relative(root,resolved).split(path.sep).join('/');rows.push({file:relative,kind:'symlink',target,canonicalTarget});if(!same(before,fingerprint(fs.lstatSync(full,{bigint:true}))))throw Error('Installed symlink changed during capture');states.set(relative,{fingerprint:before,kind:'symlink',target,canonicalTarget});
  }else if(stat.isDirectory()){directories.push({file:relative,mode:Number(stat.mode&0o777n)});states.set(relative,{fingerprint:directoryFingerprint(stat),kind:'directory'});for(const name of fs.readdirSync(full).sort()){if(!safe(name))throw Error('Invalid installed runtime entry');walk(relative+'/'+name);}if(!same(before,fingerprint(fs.lstatSync(full,{bigint:true}))))throw Error('Installed directory changed during capture');}
  else if(stat.isFile()){bytes+=Number(stat.size);if(stat.size>BigInt(64*1024**2)||bytes>maxBytes)throw Error('Installed runtime bytes exceed bound');const content=read(root,relative,{maxBytes:64*1024**2});rows.push({file:relative,kind:'file',mode:Number(stat.mode&0o777n),size:content.length,sha256:hash(content)});if(!same(before,fingerprint(fs.lstatSync(full,{bigint:true}))))throw Error('Installed input changed during capture');states.set(relative,{fingerprint:before,kind:'file'});}
  else throw Error('Installed runtime has unsupported filesystem entries');
 }
 for(const directory of ['node_modules','playground/node_modules','dist','playground/dist'])if(fs.existsSync(path.join(root,directory)))walk(directory);
 const sort=(a,b)=>a.file<b.file?-1:a.file>b.file?1:0;rows.sort(sort);directories.sort(sort);if(!rows.length||Buffer.byteLength(JSON.stringify(rows))>32*1024**2)throw Error('Installed runtime closure unavailable');freeze(rows);freeze(directories);installedSeals.set(rows,{root,states,directories});return rows;
}
/** Normalize only reviewed pnpm bookkeeping fields for implementation admission.
 * Raw metadata remains in installedInputs and the private freshness seal. */
export function captureUnimportInstallationContract(root,rows){
 root=fs.realpathSync(root);if(installedSeals.get(rows)?.root!==root)throw Error('Installation contract requires privately captured inputs');
 const files=['node_modules/.modules.yaml','node_modules/.pnpm-workspace-state-v1.json'],normalized=[];
 for(const file of files){
  const row=rows.find(row=>row.file===file&&row.kind==='file');if(!row)throw Error('Required pnpm metadata unavailable');
  const raw=read(root,file,{maxBytes:1024*1024}),text=raw.toString('utf8');if(hash(raw)!==row.sha256)throw Error('Installer metadata changed during capture');
  const value=JSON.parse(text),suffix=file.endsWith('.json')?'\n':'';
  if(JSON.stringify(value,null,2)+suffix!==text)throw Error('Noncanonical installer metadata');
  if(file.endsWith('.yaml')){
   if(value.packageManager!=='pnpm@12.3.4'||typeof value.prunedAt!=='string'||!Number.isFinite(Date.parse(value.prunedAt))||new Date(value.prunedAt).toUTCString()!==value.prunedAt||typeof value.storeDir!=='string'||!path.isAbsolute(value.storeDir)||/[\\\0\r\n]/.test(value.storeDir)||path.normalize(value.storeDir)!==value.storeDir||!value.storeDir.endsWith('/pnpm/store/v11'))throw Error('Unsupported installer bookkeeping');
   value.prunedAt='<install-date>';value.storeDir='<pnpm-store-v11>';
  }else{
   if(!Number.isSafeInteger(value.lastValidatedTimestamp)||value.lastValidatedTimestamp<=0||!value.projects||Object.keys(value.projects).sort().join('\n')!==[root,root+'/playground'].sort().join('\n'))throw Error('Unsupported workspace bookkeeping');
   value.lastValidatedTimestamp='<install-time>';value.projects={'<project>':value.projects[root],'<project>/playground':value.projects[root+'/playground']};
  }
  normalized.push({file,kind:'file',mode:row.mode,sha256:hash(JSON.stringify(value,null,2)+suffix)});
 }
 const implementationRows=rows.map(row=>normalized.find(input=>input.file===row.file)??row);
 return freeze({schemaVersion:1,profile:'original-unimport-pnpm12-bookkeeping-v1',metadata:normalized,implementationSha256:hash(implementationRows)});
}
function originalSources(root){
 const names=git(root,['ls-tree','-r','-z','--name-only',UNIMPORT_FACTORY_REVISION]).toString('utf8').split('\0').filter(Boolean).sort();
 if(names.length!==224||names.some(file=>!safe(file)))throw Error('Original unimport source inventory differs');
 const requests=names.map(file=>UNIMPORT_FACTORY_REVISION+':'+file).join('\n')+'\n',output=git(root,['cat-file','--batch'],requests),sources=[];let offset=0;
 for(const file of names){const end=output.indexOf(10,offset);if(end<0)throw Error('Original source object unavailable');const header=output.subarray(offset,end).toString('utf8'),match=/^[a-f0-9]{40} blob ([0-9]+)$/.exec(header);if(!match)throw Error('Original source is not a bound blob');const size=Number(match[1]);if(!Number.isSafeInteger(size)||size>8*1024*1024||end+size+2>output.length)throw Error('Original source object exceeds bound');const original=output.subarray(end+1,end+size+1);offset=end+size+2;if(output[offset-1]!==10)throw Error('Original source object framing differs');
  const current=read(root,file,{maxBytes:8*1024*1024}),expected=hash(original);let allowedChange='unchanged';if(hash(current)!==expected){
   if(file!==asset||original.toString('utf8')!=="export const FOO='foo',BAR='bar'\n")throw Error('Unreviewed original source modification: '+file);
   const variants={seededFixtureFault:original.toString('utf8').replace("BAR='bar'","BAZ='bar'"),inertSetupBaseline:original.toString('utf8')+'// TestLore setup baseline only; original bytes restored before all arms.\n'};
   allowedChange=Object.keys(variants).find(name=>hash(variants[name])===hash(current));if(!allowedChange)throw Error('Unreviewed fixture intervention');
  }
  sources.push({file,sha256:hash(current),originalSha256:expected,allowedChange});
 }
 if(offset!==output.length)throw Error('Unexpected original source objects');
 // New files in a scanned or loaded source domain invalidate this narrow profile.
 const expected=new Set(names),directories=new Set(names.flatMap(file=>{const parts=file.split('/');return parts.slice(0,-1).map((_,index)=>parts.slice(0,index+1).join('/'));}));function check(relative){if(!directories.has(relative))throw Error('Unreviewed source/fixture directory membership: '+relative);for(const name of fs.readdirSync(path.join(root,relative))){const file=relative+'/'+name,stat=fs.lstatSync(path.join(root,file));if(stat.isDirectory())check(file);else if(!stat.isFile()||!expected.has(file))throw Error('Unreviewed source/fixture domain membership: '+file);}}
 for(const directory of ['src','test','playground/composables','playground/composables-override'])check(directory);
 // Vite/TypeScript can discover configuration outside source import edges.
 // Refuse newly introduced search inputs, even when no import points to them.
 let configEntries=0;function checkConfiguration(relative=''){for(const name of fs.readdirSync(path.join(root,relative))){if(++configEntries>10000)throw Error('Configuration membership search exceeds bound');if(['.git','node_modules','dist'].includes(name))continue;const file=relative?relative+'/'+name:name,stat=fs.lstatSync(path.join(root,file));if(/^tsconfig.*\.json$/.test(name)||/^\.env(?:\.|$)/.test(name)){if(!stat.isFile()||!expected.has(file))throw Error('Unreviewed configuration search input: '+file);}if(stat.isDirectory())checkConfiguration(file);}}
 checkConfiguration();
 return sources;
}
export function captureUnimportRuntimeEvidence(root,command,caseProfile){
 if(caseProfile?.profile?.profile!=='unimport-detect-factory-runtime-v1')return null;
 if(process.version!=='v22.19.0'||!['darwin','linux'].includes(process.platform))return null;
 const producerFiles=['./unimport-runtime-evidence.js','./native-vitest-cases.js','./reporters/vitest-cases.js','./vitest-case-contracts.js','./native-runtime-contract.js','./native-session.js','./reporters/resolve.js','./native-project-contracts.js','./native-source-summaries.js','./graph.js','./graph-cache.js','./selector.js','./source-analysis.cjs'].map(file=>fileURLToPath(new URL(file,import.meta.url)));if(producerFiles.some(file=>!fs.existsSync(file)))return null;
 root=fs.realpathSync(root);if(caseProfile.projectRoot!==root||caseProfile.inventoryRoot!==root||caseProfile.profile.projectRoot!=='.'||caseProfile.profile.upstreamRevision!==UNIMPORT_FACTORY_REVISION||!caseProfile.observerConfiguration)throw Error('Unimport runtime evidence requires exact original observer scope');
 assertNativeVitestCases(caseProfile,captureNativeVitestCases(root,{vitestCases:caseProfile.profile},command));
 if(!Array.isArray(command)||command.length<2||fs.realpathSync(path.resolve(root,command[0]))!==fs.realpathSync(process.execPath))throw Error('Original unimport runtime requires its bound Node22.19.0 interpreter');
 const require=createRequire(path.join(root,'package.json')),manifest=require.resolve('vitest/package.json'),runtime=fs.readFileSync(manifest),metadata=JSON.parse(runtime),cli=fs.realpathSync(path.resolve(path.dirname(manifest),metadata.bin.vitest));
 if(metadata.version!=='5.0.0'||hash(runtime)!==caseProfile.runtimeManifestSha256||fs.realpathSync(path.resolve(root,command[1]))!==cli)throw Error('Selected original Vitest installation differs');
 const sourceInputs=originalSources(root),wrapper=caseProfile.observerConfiguration.file,observerBytes=read(root,wrapper);
 if(observerBytes.toString('utf8')!==unimportFactoryObserverConfigSource(root))throw Error('Original observer configuration differs');
 const installedInputs=captureInstalledUnimportInputs(root),stat=fs.lstatSync(root),node=fs.realpathSync(process.execPath);
 const producerInputs=producerFiles.map(file=>({file,sha256:hash(fs.readFileSync(file))}));
 const configurationInputs=['vitest.config.ts',wrapper].map(file=>({file,sha256:hash(read(root,file))}));
 const value={schemaVersion:1,profile:'original-unimport-runtime-facts-v1',root,environment:{CI:process.env.CI??null},inventoryIdentity:{dev:String(stat.dev),ino:String(stat.ino)},upstreamRevision:UNIMPORT_FACTORY_REVISION,command:[node,cli,...command.slice(2)],nodeIdentity:{executable:node,version:process.version,sha256:hash(fs.readFileSync(node))},sourceInputs,configurationInputs,installedInputs,installationContract:captureUnimportInstallationContract(root,installedInputs),installedDirectories:installedSeals.get(installedInputs).directories,testFiles:[...caseProfile.expectedFiles],observerConfiguration:{file:wrapper,sha256:hash(observerBytes)},producerInputs};
 value.digest=hash(value);freeze(value);const state=installedSeals.get(installedInputs);evidenceSeals.set(value,{state,command:[...command],caseProfile:structuredClone(caseProfile),nodeFingerprint:fingerprint(fs.lstatSync(node,{bigint:true})),digest:value.digest});return value;
}
export function assertUnimportRuntimeEvidence(expected,current){if(JSON.stringify(expected)!==JSON.stringify(current))throw Error('Original runtime source/configuration/installation evidence changed');}

/** Same-process freshness only. An initial full byte capture and fixed reviewed
 * installation digest remain necessary; this seal cannot cross process/JSON. */
export function assertFreshUnimportRuntimeEvidence(evidence){
 const seal=evidenceSeals.get(evidence);if(!seal||evidence.digest!==seal.digest)throw Error('Unminted or changed live runtime evidence seal');
 const {digest,...body}=evidence;if(hash(body)!==digest)throw Error('Live runtime evidence object changed');
 if(evidence.environment.CI!==(process.env.CI??null))throw Error('Native CI environment changed');
 const root=evidence.root,state=seal.state,observed=new Set();
 function walk(relative){const full=path.join(root,relative),stat=fs.lstatSync(full,{bigint:true}),expected=state.states.get(relative);if(!expected||!same(expected.kind==='directory'?directoryFingerprint(stat):fingerprint(stat),expected.fingerprint))throw Error('Installed runtime membership or filesystem identity changed');observed.add(relative);
  if(expected.kind==='directory'){if(!stat.isDirectory())throw Error('Installed directory type changed');for(const name of fs.readdirSync(full).sort())walk(relative+'/'+name);return;}
  if(expected.kind==='symlink'){if(!stat.isSymbolicLink()||fs.readlinkSync(full)!==expected.target||path.relative(root,fs.realpathSync(full)).split(path.sep).join('/')!==expected.canonicalTarget)throw Error('Installed runtime symlink changed');}else if(!stat.isFile())throw Error('Installed runtime file type changed');
 }
 for(const directory of ['node_modules','playground/node_modules','dist','playground/dist'])if(fs.existsSync(path.join(root,directory)))walk(directory);
 if(observed.size!==state.states.size)throw Error('Installed runtime membership changed');
 if(!same(fingerprint(fs.lstatSync(evidence.nodeIdentity.executable,{bigint:true})),seal.nodeFingerprint))throw Error('Native Node executable identity changed');
 assertNativeVitestCases(seal.caseProfile,captureNativeVitestCases(root,{vitestCases:seal.caseProfile.profile},seal.command));
 if(!same(originalSources(root),evidence.sourceInputs))throw Error('Original source membership/content changed');
 for(const input of evidence.configurationInputs)if(hash(read(root,input.file))!==input.sha256)throw Error('Original runtime configuration changed');
 for(const input of evidence.producerInputs)if(hash(fs.readFileSync(input.file))!==input.sha256)throw Error('Runtime evidence producer changed');
 return true;
}
