import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const PROPERTY_REPLAY_FILES=Object.freeze(['testlore.property-replay.config.mjs','testlore.property-replay.setup.mjs']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validatePropertyReplay(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['schemaVersion','seed','originalConfig'].includes(key))||value.schemaVersion!==1||!Number.isInteger(value.seed)||value.seed< -2147483648||value.seed>2147483647||typeof value.originalConfig!=='string'||!/^vitest\.config\.(?:[cm]?[jt]s)$/.test(value.originalConfig))throw Error('Property replay requires schemaVersion:1, signed int32 seed and a root vitest.config file');
 return {schemaVersion:1,seed:value.seed,originalConfig:value.originalConfig};
}

/** Explicit experimental config overlay, never a modification to upstream files. */
export function preparePropertyReplay(root,value,runner){
 const replay=validatePropertyReplay(value);if(!replay)return {runner,files:[],metadata:null};
 root=fs.realpathSync(root);
 const original=path.join(root,replay.originalConfig);
 if(!fs.lstatSync(original).isFile()||fs.realpathSync(original)!==original)throw Error('Property replay config must be an ordinary root file');
 if(!Array.isArray(runner)||runner.filter(arg=>arg==='--config'||typeof arg==='string'&&arg.startsWith('--config=')).length!==1)throw Error('Property replay requires one explicit --config');
 const args=[...runner],index=args.indexOf('--config');
 const config=index<0?args.find(arg=>arg.startsWith('--config=')).slice(9):args[index+1];
 if(config!==replay.originalConfig)throw Error('Property replay runner config differs from declared original');
 if(index<0)args[args.findIndex(arg=>arg.startsWith('--config='))]='--config='+PROPERTY_REPLAY_FILES[0];else args[index+1]=PROPERTY_REPLAY_FILES[0];
 const setup=`import fc from 'fast-check';\nconst seed=${replay.seed};\nconst prior=fc.readConfigureGlobal();\nif(prior.seed!==undefined&&prior.seed!==seed)throw Error('Existing fast-check seed conflicts with declared replay');\nfc.configureGlobal({...prior,seed});\nconst settings=fc.readConfigureGlobal();\nif(settings.seed!==seed)throw Error('Property replay seed was not applied');\nconsole.info('TESTLORE_PROPERTY_REPLAY '+JSON.stringify({schemaVersion:1,kind:'setup-observation',seed:settings.seed,numRuns:settings.numRuns??100,source:'fast-check.readConfigureGlobal'}));\n`;
 const wrapper=`import original from './${replay.originalConfig}';\nimport {defineConfig} from 'vitest/config';\nconst setup='./${PROPERTY_REPLAY_FILES[1]}';\nfunction add(test){\n if(test?.sequence?.setupFiles==='parallel')throw Error('Parallel setup is outside the property replay profile');\n return {...test,setupFiles:[...(Array.isArray(test?.setupFiles)?test.setupFiles:test?.setupFiles?[test.setupFiles]:[]),setup],sequence:{...test?.sequence,setupFiles:'list'}};\n}\nexport default defineConfig(async env=>{\n const base=await(typeof original==='function'?original(env):original);\n if(!base||typeof base!=='object'||Array.isArray(base))throw Error('Invalid property replay base config');\n const test=add(base.test);\n if(base.test?.projects){\n  if(!Array.isArray(base.test.projects)||base.test.projects.some(project=>!project||typeof project!=='object'||Array.isArray(project)||project.extends!==true||project.test?.sequence?.setupFiles==='parallel'))throw Error('Property replay only supports inline projects extending their root');\n  test.projects=base.test.projects.map(project=>({...project,...(project.test?.setupFiles?{test:add(project.test)}:{})}));\n }\n return {...base,test};\n});\n`;
 const contents=[wrapper,setup];
 for(let i=0;i<PROPERTY_REPLAY_FILES.length;i++){
  const file=path.join(root,PROPERTY_REPLAY_FILES[i]);
  // Repeated pilot overlays may reinstall their exact generated files only.
  if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.readFileSync(file,'utf8')!==contents[i]))throw Error('Property replay overlay file collision');
  if(!fs.existsSync(file))fs.writeFileSync(file,contents[i],{flag:'wx'});
 }
 return {runner:args,files:[...PROPERTY_REPLAY_FILES],metadata:{...replay,profile:'explicit-fast-check-global-seed-overlay',originalConfigSha256:hash(fs.readFileSync(original)),files:Object.fromEntries(PROPERTY_REPLAY_FILES.map((file,i)=>[file,hash(contents[i])])),inputReplayCertified:false,limitation:'Global seed control preserves upstream run budgets. Explicit test seeds must be checked in raw names; external nondeterminism and exact generated inputs are not certified.'}};
}

/** Verify observed seed-bearing names without renaming or normalizing cases. */
export function observePropertyReplay(tests,seed){
 if(!Number.isInteger(seed)||seed< -2147483648||seed>2147483647)throw Error('Invalid property replay seed');
 const cases=[];
 for(const test of tests||[]){
  const match=typeof test.name==='string'&&test.name.match(/ \(with seed=(-?\d+)\)$/);
  if(match)cases.push({file:test.file,name:test.name,seed:Number(match[1]),status:test.status});
 }
 return {schemaVersion:1,requestedSeed:seed,complete:cases.length>0&&cases.every(test=>test.seed===seed),cases,kind:'observed-fast-check-vitest-title-seeds',inputReplayCertified:false};
}
