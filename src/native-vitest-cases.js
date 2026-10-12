import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {listFiles,safePath} from './files.js';
import {e2eLocatorRegistrationContract,unimportFactoryRegistrationContract,unimportFactoryObserverConfigSource,readVitestCaseSource,vitestCaseHash} from './vitest-case-contracts.js';

const producers=['./reporters/vitest-cases.js','./vitest-case-contracts.js'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
const excluded=new Set(['.git','node_modules','.tddswarm','dist','build','coverage','.next']);
function directory(root,file){
 if(typeof file!=='string'||!file||file.length>4096||/[\\\0\r\n]/.test(file)||path.isAbsolute(file)||file!=='.'&&file.split('/').some(part=>!part||part==='.'||part==='..'||excluded.has(part)))throw Error('Invalid native case project root');
 const absolute=file==='.'?root:safePath(root,file),stat=fs.lstatSync(absolute);
 if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(absolute)!==absolute)throw Error('Native case project root must be a canonical directory');
 return {absolute,dev:String(stat.dev),ino:String(stat.ino)};
}
function configFile(root,command){
 const values=[];
 for(let i=0;i<command.length;i++)if(['--config','-c'].includes(command[i]))values.push(command[++i]);else if(command[i].startsWith('--config='))values.push(command[i].slice(9));else if(command[i].startsWith('-c='))values.push(command[i].slice(3));
 if(values.length>1)throw Error('Native cases require one original config');
 const full=values.length?path.resolve(root,values[0]):null;
 return full;
}
/** Optional reviewed observational profile; never a routing authority. */
export function captureNativeVitestCases(root,config,command){
 const profile=config.vitestCases;if(profile===undefined)return null;
 if(!profile||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).sort().join(',')!=='profile,projectRoot,upstreamRevision'||!['e2e-locator-runtime-v1','unimport-detect-factory-runtime-v1'].includes(profile.profile))throw Error('Unsupported native case profile');
 const requested=path.resolve(root);root=fs.realpathSync(requested);const inventory=fs.lstatSync(requested);
 if(root!==requested||inventory.isSymbolicLink()||!inventory.isDirectory())throw Error('Native case inventory root must be canonical');
 const project=directory(root,profile.projectRoot);
 const metadata=createRequire(path.join(project.absolute,'package.json')).resolve('vitest/package.json'),runtimeBytes=fs.readFileSync(metadata),version=JSON.parse(runtimeBytes).version;
 const unimport=profile.profile==='unimport-detect-factory-runtime-v1';
 if(unimport&&version!=='5.0.0')throw Error('Original unimport runtime requires Vitest5.0.0');
 const contract=(unimport?unimportFactoryRegistrationContract:e2eLocatorRegistrationContract)(project.absolute,{upstreamRevision:profile.upstreamRevision,vitestVersion:version});
 const files=listFiles(root),prefix=profile.projectRoot==='.'?'':profile.projectRoot+'/';
 const expectedFiles=files.filter(file=>file.startsWith(prefix)&&(unimport?/^test\/.*\.test\.ts$/:/^tests\/unit\/.*\.test\.ts$/).test(file.slice(prefix.length))).map(file=>file.slice(prefix.length)).sort();
 if(expectedFiles.length!==(unimport?28:174)||!expectedFiles.includes(contract.file))throw Error('Reviewed native case profile requires exactly '+(unimport?28:174)+' inventoried tests');
 const original=configFile(root,command)||['vitest.config.ts','vitest.config.mts','vitest.config.js','vitest.config.mjs','vitest.config.cts','vitest.config.cjs'].map(file=>path.join(project.absolute,file)).find(file=>fs.existsSync(file));
 if(!original)throw Error('Original native case config required');
 const configRelative=path.relative(project.absolute,original).split(path.sep).join('/');
 if(configRelative.startsWith('../')||path.isAbsolute(configRelative)||!files.includes(prefix+configRelative))throw Error('Original native case config must be in the reviewed project inventory');
 let total=0;const inputs=[...expectedFiles,configRelative].map(file=>{const bytes=readVitestCaseSource(project.absolute,file);total+=bytes.length;if(total>32*1024*1024)throw Error('Native case source bytes exceed bound');return {file,sha256:vitestCaseHash(bytes)};});
 const observerConfiguration=unimport&&configRelative==='testlore.observation.config.mjs'&&readVitestCaseSource(project.absolute,configRelative).toString('utf8')===unimportFactoryObserverConfigSource(project.absolute)?{file:configRelative,sha256:vitestCaseHash(readVitestCaseSource(project.absolute,configRelative))}:null;
 return {schemaVersion:1,...(unimport?{observerConfiguration}:{}),profile:structuredClone(profile),inventoryRoot:root,inventoryIdentity:{dev:String(inventory.dev),ino:String(inventory.ino)},projectRoot:project.absolute,projectIdentity:{dev:project.dev,ino:project.ino},vitestVersion:version,runtimeManifestSha256:vitestCaseHash(runtimeBytes),producerSha256:producers.map(file=>vitestCaseHash(fs.readFileSync(file))),expectedFiles,inputs,registrationContracts:[contract],omissionAuthority:false};
}
export function assertNativeVitestCases(expected,current){if(JSON.stringify(expected)!==JSON.stringify(current))throw Error('Native case profile/source/producer/runtime binding changed');}
export function captureNativeCaseConfiguration(root,files){
 const inputs=[...new Set(files.filter(file=>!file.split(path.sep).includes('node_modules')))].sort();
 if(inputs.length>12000)throw Error('Native case configuration inputs exceed bound');
 let total=0;
 return inputs.map(absolute=>{const file=path.relative(root,absolute).split(path.sep).join('/'),bytes=readVitestCaseSource(root,file);total+=bytes.length;if(total>32*1024*1024)throw Error('Native case configuration bytes exceed bound');return {file,sha256:vitestCaseHash(bytes)};});
}
export function assertNativeCaseConfiguration(root,expected){
 if(!Array.isArray(expected)||expected.length>12000||expected.some(input=>typeof input?.file!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256)))throw Error('Invalid native case configuration binding');
 const actual=captureNativeCaseConfiguration(root,expected.map(input=>safePath(root,input.file)));
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Native case configuration binding changed');
}
