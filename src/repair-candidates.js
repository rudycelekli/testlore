import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {SOURCE, TEST, safePath, readConfig} from './files.js';
import {digest, freshness, snapshot} from './provenance.js';
import {adapterFor, discover, execute, nativeEnvironment} from './execution.js';
import {withRepairEnvironment} from './repair-environment.js';
import {captureRepairChallenges,captureChallengeRuntime,captureNativeRepairRuntime,runRepairChallenges,assessRepairChallenges} from './repair-challenges.js';

const MAX_TEXT = 65536, MAX_REPORT = 2 * 1024 * 1024;
const canonical = file => typeof file === 'string' && !file.includes('\\') && !file.includes('\0') && !path.isAbsolute(file) && file.split('/').every(part => part && part !== '.' && part !== '..');
/** Pure admission predicate. Existence and explicit ownership are checked at staging. */
export function isRepairSourcePath(file) {
  return canonical(file) && (/^(?:src|lib|app)\//.test(file) || /^index\.[cm]?js$/.test(file)) && file.split('/').every(part=>!part.startsWith('.')) && SOURCE.test(file) && !TEST.test(file) &&
    !/(?:^|\/)(?:[^/]*(?:test|spec|config|fixture|helper|mock|setup)[^/]*|__[^/]+__|node_modules|dist|build)(?:\/|\.|$)/i.test(file);
}
function regular(root, file) {
  const target = safePath(root, file);
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) throw new Error(`Existing regular file required: ${file}`);
  return target;
}
function readJson(file) {
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > MAX_REPORT) throw new Error('Repair evidence file exceeds bound');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function reviewValid(review) {
  if (!review || typeof review.accepted !== 'boolean' || !Array.isArray(review.findings) || review.findings.length > 100 || review.findings.some(x => typeof x !== 'string' || x.length > 4096)) throw new Error('Repair requires bounded independent review');
}
// Traverse ignored files too: an oracle hidden by Git must still be immutable.
// Installed dependencies are trusted executable code, shared read-only by policy,
// and independently hashed before/after. This is not an OS security sandbox.
function tree(root, {dependencies = false, deadline = Infinity} = {}) {
  const files = Object.create(null), base = dependencies ? path.join(root, 'node_modules') : root;
  if (!fs.existsSync(base)) return {files, fingerprint: digest(files)};
  const realBase = fs.realpathSync(base); let bytes = 0, count = 0;
  function walk(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (performance.now() > deadline) throw new Error('repair-total-time-budget-exceeded');
      if (!dependencies && !prefix && ['.git', '.tddswarm', 'node_modules'].includes(item.name)) continue;
      if (!dependencies && prefix && ['.git','node_modules'].includes(item.name)) throw new Error('Nested repository/dependencies require an unsupported repair profile');
      const file = prefix + item.name, target = path.join(directory, item.name), stat = fs.lstatSync(target);
      if (++count > (dependencies ? 100000 : 10000)) throw new Error('Repair snapshot file budget exceeded');
      if (stat.isSymbolicLink()) {
        if (!dependencies || !fs.realpathSync(target).startsWith(realBase + path.sep)) throw new Error(`Unsupported snapshot symlink: ${file}`);
        files[file] = {link: fs.readlinkSync(target)};
      } else if (stat.isDirectory()) walk(target, file + '/');
      else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > (dependencies ? 1024 * 1024 * 1024 : 64 * 1024 * 1024)) throw new Error('Repair snapshot byte budget exceeded');
        const hash = createHash('sha256'), fd = fs.openSync(target, 'r'), buffer = Buffer.alloc(65536);
        try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
        finally { fs.closeSync(fd); }
        files[file] = {hash: hash.digest('hex'), mode: stat.mode & 0o777};
      } else throw new Error(`Unsupported snapshot entry: ${file}`);
    }
  }
  walk(realBase);
  return dependencies ? {fingerprint:digest(files),count,bytes} : {files, fingerprint: digest(files)};
}
function state(root, deadline) {
  const scope = tree(root, {deadline}), dependencies = tree(root, {dependencies:true, deadline}), config = readConfig(root);
  if(Object.keys(config.services||{}).length)throw new Error('External service repair evidence is unsupported');
  const result={scope, dependencies, provenance:snapshot(root,config),nativeRuntime:captureNativeRepairRuntime(root,config)};
  if(performance.now()>deadline)throw new Error('repair-total-time-budget-exceeded');
  return result;
}
export function captureRepairState(root,{deadline=performance.now()+30000}={}) {return state(root,deadline);}
function assertFresh(manifest, current) {
  const check = freshness(manifest.state.provenance, current.provenance);
  if (!check.fresh || manifest.state.provenance.revision !== current.provenance.revision || manifest.state.scope.fingerprint !== current.scope.fingerprint || manifest.state.dependencies.fingerprint !== current.dependencies.fingerprint || digest(manifest.state.nativeRuntime)!==digest(current.nativeRuntime)) throw new Error('Repair inputs are stale: '+ check.reasons.join(', '));
}
function locate(root, candidatePath) {
  if (typeof candidatePath !== 'string' || !/^\.tddswarm\/repairs\/[a-f0-9-]{36}$/.test(candidatePath)) throw new Error('Invalid repair candidate path');
  const directory = safePath(root, candidatePath), manifest = readJson(regular(directory,'manifest.json'));
  if (manifest.kind !== 'source-repair' || manifest.schemaVersion !== 1 || candidatePath !== `.tddswarm/repairs/${manifest.id}` || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 3 || !Array.isArray(manifest.sourcePaths)) throw new Error('Invalid repair manifest');
  reviewValid(manifest.review);
  const seen = new Set(); let bytes = 0;
  for (const file of manifest.files) {
    if (!isRepairSourcePath(file.path) || !manifest.sourcePaths.includes(file.path) || seen.has(file.path)) throw new Error('Invalid repair source ownership');
    seen.add(file.path); regular(root,file.path);
    const content = fs.readFileSync(regular(directory,`files/${file.path}`)); bytes += content.length;
    if (bytes > MAX_TEXT || digest(content) !== file.hash || manifest.state?.scope?.files?.[file.path]?.hash !== file.beforeHash) throw new Error('Repair candidate content changed');
  }
  if (manifest.requirementsPath !== 'tddswarm.requirements.md' || digest(manifest.requirements) !== manifest.requirementsHash || digest(fs.readFileSync(regular(root,manifest.requirementsPath))) !== manifest.requirementsHash) throw new Error('Independent repair requirements changed');
  return {directory,manifest,hash:digest(manifest)};
}
/** Stage source-only proposals; original tests, requirements and configuration cannot be edited. */
export function stageRepair(root, {files, requirements, sourcePaths, review} = {}) {
  if (!Array.isArray(files) || !files.length || files.length > 3 || !Array.isArray(sourcePaths) || !sourcePaths.length || sourcePaths.length > 32 || new Set(sourcePaths).size !== sourcePaths.length || sourcePaths.some(file => !isRepairSourcePath(file))) throw new Error('Repair requires 1–3 files and explicit existing source ownership');
  reviewValid(review);
  if (typeof requirements !== 'string' || !requirements.trim() || Buffer.byteLength(requirements) > 65536 || fs.readFileSync(regular(root,'tddswarm.requirements.md'),'utf8') !== requirements) throw new Error('Existing independent requirements must match exactly');
  sourcePaths.forEach(file => regular(root,file));
  const before = state(root, performance.now()+30000), seen = new Set(); let bytes = 0;
  for (const file of files) {
    if (!file || !sourcePaths.includes(file.path) || !isRepairSourcePath(file.path) || seen.has(file.path) || typeof file.content !== 'string') throw new Error('Invalid repair file');
    seen.add(file.path); bytes += Buffer.byteLength(file.content);
    if (bytes > MAX_TEXT || digest(file.content) === before.scope.files[file.path]?.hash) throw new Error('Repair exceeds text budget or has no source change');
    regular(root,file.path);
  }
  const id = randomUUID(), candidatePath = `.tddswarm/repairs/${id}`, directory = safePath(root,candidatePath);
  fs.mkdirSync(directory,{recursive:true});
  for (const file of files) { const target = safePath(directory,`files/${file.path}`); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,file.content,{flag:'wx'}); }
  const challenges=captureRepairChallenges(root);
  if(challenges.status==='configured'&&challenges.cases.some(item=>sourcePaths.includes(item.script)))throw Error('Repair source cannot own challenge assertions');
  const manifest = {schemaVersion:1,kind:'source-repair',id,state:before,sourcePaths,files:files.map(file=>({path:file.path,hash:digest(file.content),beforeHash:before.scope.files[file.path].hash})),requirementsPath:'tddswarm.requirements.md',requirements,requirementsHash:digest(requirements),review,challenges,...(challenges.status==='configured'?{challengeRuntime:captureChallengeRuntime()}:{})};
  const serialized=JSON.stringify(manifest,null,2);if(Buffer.byteLength(serialized)>MAX_REPORT){fs.rmSync(directory,{recursive:true,force:true});throw new Error('Repair manifest evidence exceeds bound');}
  fs.writeFileSync(path.join(directory,'manifest.json'),serialized);
  return {id,directory,candidatePath,kind:'source-repair',status:review.accepted?'reviewed-repair':'rejected-repair',applied:false};
}
function inventory(report) {
  if (!report?.complete || !Array.isArray(report.tests) || !report.tests.length || report.error || report.signal || report.reportErrors?.length || report.missingFiles?.length || report.unknownFiles?.length) throw new Error('incomplete-native-case-evidence');
  const map = new Map();
  for (const item of report.tests) {
    if (!canonical(item.file) || typeof item.name !== 'string' || !item.name.trim() || item.name === '<file-load>' || !['passed','failed','skipped'].includes(item.status)) throw new Error('invalid-native-case-evidence');
    const key = JSON.stringify([item.file,item.name]);
    if (map.has(key)) throw new Error('ambiguous-native-case-identity');
    map.set(key,item.status);
  }
  return [...map].sort(([a],[b])=>a.localeCompare(b));
}
const assertionReporter = `function errorData(error,depth=0){if(!error||depth>4)return null;return {code:error.code,name:error.name,cause:errorData(error.cause,depth+1)}}
export default async function* reporter(source){for await(const event of source){if(!['test:pass','test:fail','test:summary'].includes(event.type))continue;const d=event.data||{};yield JSON.stringify({type:event.type,data:{name:d.name,file:d.file,nesting:d.nesting,skip:d.skip,todo:d.todo,counts:d.counts,details:d.details&&{type:d.details.type,error:errorData(d.details.error)}}})+'\\n'}}`;
function assertionProbe(root, report, config, timeoutMs) {
  const started=performance.now();
  const local=file=>{const relative=path.relative(fs.realpathSync(root),path.isAbsolute(file)?fs.realpathSync(file):path.resolve(root,file)).split(path.sep).join('/');if(!canonical(relative))throw new Error('assertion-probe-foreign-file');regular(root,relative);return relative;};
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'testlore-assertion-'));
  try {
    const reporter = path.join(temp,'reporter.mjs'), destination = path.join(temp,'events.jsonl'); fs.writeFileSync(reporter,assertionReporter);
    const command = report.command.map(arg => arg.startsWith('--test-reporter=')?`--test-reporter=${reporter}`:arg.startsWith('--test-reporter-destination=')?`--test-reporter-destination=${destination}`:arg);
    const run = spawnSync(command[0],command.slice(1),{cwd:root,env:nativeEnvironment(config),timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:MAX_REPORT,encoding:'utf8'});
    if (run.error || run.signal || run.status === null || !fs.existsSync(destination) || fs.statSync(destination).size > MAX_REPORT) throw new Error('assertion-probe-incomplete');
    const events = fs.readFileSync(destination,'utf8').trim().split('\n').map(line=>JSON.parse(line)), names = new Map(), hierarchy = new Map();
    for (let i=events.length-1;i>=0;i--) {
      const {type,data:d}=events[i]; if (!['test:pass','test:fail'].includes(type)||!d.file) continue;
      const file = local(d.file);
      if (!Number.isInteger(d.nesting)||d.nesting<0||d.nesting>128||typeof d.name!=='string') throw new Error('assertion-probe-invalid-ancestry');
      const ancestors = hierarchy.get(file)||[]; ancestors[d.nesting]=d.name;ancestors.length=d.nesting+1;hierarchy.set(file,ancestors);
      if (Array.from({length:d.nesting},(_,index)=>ancestors[index]).some(name=>typeof name!=='string')) throw new Error('assertion-probe-incomplete-ancestry');
      names.set(events[i],ancestors.join(' > '));
    }
    const tests = [], assertions = [];
    for (const event of events) {
      const {type,data:d}=event;if(!['test:pass','test:fail'].includes(type)||!d.file||d.details?.type==='suite')continue;
      const file=local(d.file); if(d.name===d.file||d.name===file){if(type==='test:fail')throw new Error('assertion-probe-file-load-failed');continue;}
      const name=names.get(event),status=d.skip||d.todo?'skipped':type==='test:pass'?'passed':'failed'; tests.push({file,name,status});
      if(status==='failed'){let e=d.details?.error,assertion=false;while(e){if(e.code==='ERR_ASSERTION'&&e.name==='AssertionError')assertion=true;e=e.cause;}if(!assertion)throw new Error('failure-is-not-native-assertion');assertions.push({file,name,code:'ERR_ASSERTION',nameOfError:'AssertionError'});}
    }
    const summary = events.filter(event=>event.type==='test:summary'&&!event.data.file);
    if(summary.length!==1||!Number.isInteger(summary[0].data.counts?.tests)||tests.length>summary[0].data.counts.tests||!assertions.length||run.status===0)throw new Error('assertion-probe-missing-failures');
    if(digest(inventory({complete:true,tests}))!==digest(inventory(report)))throw new Error('assertion-probe-case-status-drift');
    return {complete:true,exitCode:run.status,assertions,tests,command,durationMs:Math.round(performance.now()-started)};
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
function seal(root,value,{create=false}={}) {
  const keyPath=safePath(root,'.tddswarm/repair-validation.key');
  if(create&&!fs.existsSync(keyPath)){fs.mkdirSync(path.dirname(keyPath),{recursive:true});try{fs.writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
  const key=fs.readFileSync(regular(root,'.tddswarm/repair-validation.key'));
  if(key.length!==32)throw new Error('Invalid local repair validation key');
  return createHmac('sha256',key).update(JSON.stringify(value)).digest('hex');
}
function copied(root, scope, action) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-repair-'));
  try {
    for(const [file,value] of Object.entries(scope.files)){const target=safePath(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(regular(root,file),target);fs.chmodSync(target,value.mode);}
    if(fs.existsSync(path.join(root,'node_modules')))fs.symlinkSync(fs.realpathSync(path.join(root,'node_modules')),path.join(temp,'node_modules'),'dir');
    return action(temp);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
/** Four independent full executions; Node assertion probes add two further baseline runs. */
export function validateRepair(root, candidatePath, options={}) {
  const started=performance.now(),total=options.totalTimeoutMs??120000,perRun=options.timeoutMs??20000;
  if(!Number.isInteger(total)||total<1||total>600000||!Number.isInteger(perRun)||perRun<1||perRun>120000)throw new Error('Invalid bounded repair runtime budget');
  const deadline=started+total,{directory,manifest,hash}=locate(root,candidatePath),baseline=[],candidateRuns=[],assertionRuns=[],challengeBaseline=[],challengeCandidate=[],reasons=[];
  const remaining=()=>{const value=Math.floor(Math.min(perRun,deadline-performance.now()));if(value<1)throw new Error('repair-total-time-budget-exceeded');return value;};
  const nativeFresh=()=>{if(manifest.state.nativeRuntime?.status!=='qualified'||digest(captureNativeRepairRuntime(root))!==digest(manifest.state.nativeRuntime))throw Error('native-execution-mutated-runtime');};
  try {
    assertFresh(manifest,state(root,deadline));
    if(manifest.state.nativeRuntime?.status!=='qualified')throw new Error('assertion-evidence-unsupported: '+(manifest.state.nativeRuntime?.reason||'repair-native-runtime-binding-required'));
    if(!manifest.review.accepted||!manifest.review.oracle?.independent||!Array.isArray(manifest.review.oracle.basis)||!manifest.review.oracle.basis.length||manifest.review.oracle.basis.some(x=>typeof x!=='string'||!x.trim()||x.length>4096))throw new Error('independent-repair-review-required');
    const config=readConfig(root);
    const argv=config.runner||['node','--test','{files}'];
    if(adapterFor(config)!=='node'||config.integration||Array.isArray(config.discovery)||!/(?:^|[\/\\])node(?:\.exe)?$/.test(argv[0])||!argv.includes('--test')||argv.slice(1).some(arg=>arg!=='{files}'&&!arg.startsWith('-'))||argv.some(arg=>/^--test-(?:name-pattern|skip-pattern|only|force-exit)(?:=|$)/.test(arg)))throw new Error('assertion-evidence-unsupported');
    for(const candidate of [false,false,true,true]) {
      nativeFresh();
      const result=copied(root,manifest.state.scope,temp=>{
        if(candidate)for(const file of manifest.files)fs.writeFileSync(regular(temp,file.path),fs.readFileSync(regular(directory,`files/${file.path}`)));
        const before=tree(temp,{deadline}),localConfig=readConfig(temp);
        return withRepairEnvironment(localConfig,isolatedConfig=>{
        const discovery=discover(temp,{...isolatedConfig,discovery:'native',runnerTimeoutMs:remaining()});
        nativeFresh();
        if(!discovery.complete||!discovery.files.length)throw new Error('full-native-discovery-incomplete-or-empty');
        if(discovery.files.some(file=>manifest.sourcePaths.includes(file)))throw new Error('repair-source-is-native-test-file');
        const report={...execute(temp,discovery.files,isolatedConfig,{capture:true,timeoutMs:remaining()}),discovery};
        nativeFresh();
        if(Buffer.byteLength(JSON.stringify(report))>MAX_REPORT)throw new Error('repair-report-output-budget-exceeded');
        (candidate?candidateRuns:baseline).push(report);
        const cases=inventory(report);
        if(discovery.files.some(file=>!report.collectionFiles?.includes(file))||report.collectionFiles?.some(file=>!discovery.files.includes(file)))throw new Error('native-full-scope-mismatch');
        if(candidate){if(report.exitCode!==0||cases.some(([,status])=>status==='failed'))throw new Error('candidate-suite-not-all-green');}
        else {if(report.exitCode===0||!cases.some(([,status])=>status==='failed'))throw new Error('repeatable-assertion-baseline-required');assertionRuns.push(withRepairEnvironment(localConfig,probeConfig=>assertionProbe(temp,report,probeConfig,remaining())));nativeFresh();}
        if(tree(temp,{deadline}).fingerprint!==before.fingerprint)throw new Error('native-execution-mutated-project-inputs');
        if(manifest.challenges?.status==='configured') {
          const challenge=runRepairChallenges(temp,manifest.challenges,{sourcePaths:manifest.sourcePaths,runtime:manifest.challengeRuntime,timeoutMs:remaining(),deadline,assertFresh:()=>{
            nativeFresh();
            if(tree(temp,{deadline}).fingerprint!==before.fingerprint||tree(root,{dependencies:true,deadline}).fingerprint!==manifest.state.dependencies.fingerprint)throw Error('repair-challenge-project-or-dependency-drift');
          }});
          (candidate?challengeCandidate:challengeBaseline).push(challenge);
          if(!challenge.accepted)throw Error(candidate?'independent-challenge-candidate-regression':'independent-challenge-baseline-not-passing');
        }
        return report;
        });
      });
      if(tree(root,{dependencies:true,deadline}).fingerprint!==manifest.state.dependencies.fingerprint)throw new Error('native-execution-mutated-dependencies');
      if(digest(captureNativeRepairRuntime(root))!==digest(manifest.state.nativeRuntime))throw Error('native-execution-mutated-runtime');
      if(baseline.length===2&&digest(inventory(baseline[0]))!==digest(inventory(baseline[1])))throw new Error('baseline-case-outcomes-not-repeatable');
      if(candidate){const expected=inventory(baseline[0]).map(([key,status])=>[key,status==='skipped'?'skipped':'passed']);if(digest(expected)!==digest(inventory(result)))throw new Error('original-case-inventory-or-skip-status-changed');}
    }
    assertFresh(manifest,state(root,deadline));
    if(digest(locate(root,candidatePath).manifest)!==hash)throw new Error('repair-manifest-changed-during-validation');
  }catch(error){reasons.push(error.message.slice(0,1000));}
  const challenges=manifest.challenges?.status==='configured'?assessRepairChallenges(challengeBaseline,challengeCandidate):{status:'not-configured',accepted:false,next:['Suite-only validation does not qualify production repair readiness; configure independent behavioral challenges.']};
  if(manifest.challenges?.status==='configured'&&!challenges.accepted)reasons.push(...challenges.reasons);
  const result={schemaVersion:1,kind:'source-repair',accepted:!reasons.length&&baseline.length===2&&candidateRuns.length===2&&assertionRuns.length===2,reasons,manifestHash:hash,inputFingerprint:digest(manifest.state),baseline,candidateRuns,assertionRuns,challenges,qualification:challenges.accepted?'suite-and-independent-challenges':'original-suite-only',original:baseline[0]??null,candidate:candidateRuns[0]??null,durationMs:Math.round(performance.now()-started),bounds:{totalTimeoutMs:total,perNativeTimeoutMs:perRun,retainedReportBytes:MAX_REPORT,nativeTransportMaxBufferBytes:64*1024*1024},cost:null};
  if(Buffer.byteLength(JSON.stringify(result,null,2))>MAX_REPORT-512){result.accepted=false;result.reasons.push('repair-total-evidence-output-budget-exceeded');result.baseline=[];result.candidateRuns=[];result.assertionRuns=[];result.challenges={status:'rejected',accepted:false,reasons:['repair-total-evidence-output-budget-exceeded']};result.original=null;result.candidate=null;}
  result.integrity=seal(root,result,{create:true});fs.writeFileSync(safePath(directory,'validation.json'),JSON.stringify(result,null,2));return result;
}
/** Apply only an accepted, fresh source repair. No tests or requirements are touched. */
export function applyRepair(root,candidatePath) {
  const {directory,manifest,hash}=locate(root,candidatePath),receipt=readJson(regular(directory,'validation.json')),{integrity,...body}=receipt;
  if(integrity!==seal(root,body)||!receipt.accepted||receipt.kind!=='source-repair'||receipt.manifestHash!==hash||receipt.inputFingerprint!==digest(manifest.state)||receipt.baseline?.length!==2||receipt.candidateRuns?.length!==2||receipt.assertionRuns?.length!==2)throw new Error('Accepted intact repair validation required');
  if(manifest.challenges?.status==='configured'&&!receipt.challenges?.accepted)throw Error('Accepted independent regression challenges required');
  if(manifest.challengeRuntime&&digest(captureChallengeRuntime())!==digest(manifest.challengeRuntime))throw Error('Repair challenge runtime changed before apply');
  assertFresh(manifest,state(root,performance.now()+30000));
  const originals=manifest.files.map(file=>({path:file.path,bytes:fs.readFileSync(regular(root,file.path)),mode:fs.statSync(regular(root,file.path)).mode&0o777})),prepared=[];let applied=0;
  try {
    for(const file of manifest.files){const target=regular(root,file.path),temp=target+`.testlore-${randomUUID()}`;fs.writeFileSync(temp,fs.readFileSync(regular(directory,`files/${file.path}`)),{flag:'wx',mode:fs.statSync(target).mode&0o777});prepared.push({target,temp});}
    for(let index=0;index<prepared.length;index++){if(digest(fs.readFileSync(prepared[index].target))!==manifest.files[index].beforeHash)throw new Error('Repair source changed before apply');fs.renameSync(prepared[index].temp,prepared[index].target);applied++;}
  }catch(error){for(let index=0;index<applied;index++){const file=originals[index];if(digest(fs.readFileSync(regular(root,file.path)))===manifest.files[index].hash){fs.writeFileSync(regular(root,file.path),file.bytes);fs.chmodSync(regular(root,file.path),file.mode);}}throw error;}
  finally {for(const file of prepared)fs.rmSync(file.temp,{force:true});}
  const result={kind:'source-repair',applied:true,files:manifest.files.map(file=>file.path),validationIntegrity:integrity};fs.writeFileSync(safePath(directory,'applied.json'),JSON.stringify(result,null,2));return result;
}

/** Reconcile local authenticated evidence with the exact post-apply bytes.
 * A new fix commit may change HEAD; the publication controller independently
 * binds its exact SHA. Local authentication is not an OS security boundary. */
export function verifyAppliedRepairValidation(root,candidatePath,{deadline=performance.now()+30000}={}) {
 if(!Number.isFinite(deadline)||deadline<=performance.now())throw Error('Repair publication freshness deadline exhausted');
 const {directory,manifest,hash}=locate(root,candidatePath),receipt=readJson(regular(directory,'validation.json')),{integrity,...body}=receipt;
 if(typeof integrity!=='string'||integrity!==seal(root,body)||receipt.kind!=='source-repair'||receipt.accepted!==true||receipt.manifestHash!==hash||receipt.inputFingerprint!==digest(manifest.state)||receipt.baseline?.length!==2||receipt.candidateRuns?.length!==2||receipt.assertionRuns?.length!==2)throw Error('Authenticated accepted repair validation required for publication');
 if(manifest.challenges?.status!=='configured'||receipt.challenges?.accepted!==true||!assessRepairChallenges(receipt.challenges.baseline,receipt.challenges.candidate).accepted)throw Error('Authenticated independent repair challenges required for publication');
 if(digest(captureRepairChallenges(root))!==digest(manifest.challenges)||digest(captureChallengeRuntime())!==digest(manifest.challengeRuntime))throw Error('Repair challenge oracle or runtime changed before publication');
 const source=applied=>manifest.sourcePaths.map(file=>({file,sha256:applied?(manifest.files.find(item=>item.path===file)?.hash??manifest.state.scope.files[file].hash):manifest.state.scope.files[file].hash,bytes:fs.statSync(regular(root,file)).size}));
 // Baseline byte lengths can differ from the applied file. Bind their hashes
 // and owned paths; exact candidate lengths are reconciled with current bytes.
 const expectedBaseline=source(false).map(({file,sha256})=>({file,sha256})),expectedCandidate=source(true);
 for(const [runs,expected,baseline] of [[receipt.challenges.baseline,expectedBaseline,true],[receipt.challenges.candidate,expectedCandidate,false]])for(const run of runs){
  const actual=baseline?run.source.map(({file,sha256})=>({file,sha256})):run.source;
  if(digest(actual)!==digest(expected)||run.identity!==manifest.challenges.identity||digest(run.runtime)!==digest(manifest.challengeRuntime))throw Error('Repair challenge source bindings differ from authenticated manifest');
 }
 const applied=readJson(regular(directory,'applied.json'));
 if(applied.kind!=='source-repair'||applied.applied!==true||applied.validationIntegrity!==integrity||digest(applied.files)!==digest(manifest.files.map(item=>item.path)))throw Error('Applied repair record differs from authenticated validation');
 const current=state(root,deadline),expectedFiles=structuredClone(manifest.state.scope.files);
 for(const file of manifest.files)expectedFiles[file.path]={...expectedFiles[file.path],hash:file.hash};
 if(current.dependencies.fingerprint!==manifest.state.dependencies.fingerprint)throw Error('Repair installed dependencies changed before publication');
 if(manifest.state.nativeRuntime?.status!=='qualified'||digest(current.nativeRuntime)!==digest(manifest.state.nativeRuntime))throw Error('Repair native runtime changed before publication');
 if(current.scope.fingerprint!==digest(expectedFiles)||current.provenance.runner!==manifest.state.provenance.runner||digest(current.provenance.services)!==digest(manifest.state.provenance.services))throw Error('Repair protected project inputs changed before publication');
 return {receipt,manifest,manifestHash:hash,currentInputFingerprint:digest({scope:current.scope,dependencies:current.dependencies})};
}
