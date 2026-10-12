import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {routingProposals,validateRoutingProposals} from '../src/routing-proposals.js';
import {digest} from '../src/provenance.js';

// Frozen primary-source expectations. This is diagnosis qualification, never
// a dependency completeness, effective-launch, test-selection or speed proof.
const revision='3dcb732da33f6ceef597506b14a4536f1c9aff96';
const fixture='tests/fixtures/android/jadx-mcp.mjs';
const bridge='tests/fixtures/android/jadx.ts';
const consumer='tests/boundary/android/jadxIntegration.test.ts';
const fake='tests/boundary/android/jadxMcpTransport.test.ts';
const sourceHashes={
  [fixture]:'69edc536221148c05bfa22344f48a647c375c0bc50416d4b0bd62a6ed7af66cd',
  [bridge]:'2c0191f41b926d56b075e99037844b46d88c5b4f9c69ee4f46aa995a7741d27d'
};

const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--root'||args[2]!=='--output')throw Error('Expected --root original-REA-checkout --output evidence-directory');
const root=path.resolve(args[1]),directory=path.resolve(args[3]);
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).trim(),revision);
for(const [file,expected] of Object.entries(sourceHashes))assert.equal(digest(fs.readFileSync(path.join(root,file))),expected,file);
const start=performance.now(),report=routingProposals(root);
assert.equal(report.stable,true);assert.equal(validateRoutingProposals(root,report).valid,true);
assert.equal(report.processRegistrationDiagnostic,null);
const diagnostic=report.processRegistrations,item=diagnostic.proposals.find(item=>item.fixture===fixture);
assert.ok(item,'Original child registration fixture must be diagnosed');
assert.equal(item.sourceSha256,sourceHashes[fixture]);
assert.ok(item.stateOwners.some(owner=>owner.helper==='register'&&owner.receiver==='server'));
assert.ok(item.launches.some(launch=>launch.source===bridge&&launch.sourceSha256===sourceHashes[bridge]&&launch.sink.file==='src/process/ProviderProcess.ts'&&launch.executionObserved===false));
assert.deepEqual(item.consumers,[]);
assert.ok(item.excludedConsumerCandidates.some(candidate=>candidate.file===consumer),'Actual bridge-import candidate is outside the native three-project inventory');
assert.equal([...item.discoveredConsumerCandidates,...item.excludedConsumerCandidates].some(candidate=>candidate.file===fake),false,'Injected transport command must not establish fixture association');
assert.ok(item.uncertainties.includes('consumer-candidates-outside-native-inventory'));
assert.ok(item.uncertainties.includes('runtime-executable-unbound'));
assert.ok(item.uncertainties.includes('effective-process-inputs-unbound'));
for(const reason of ['inherited-process-options','inherited-environment','dynamic-environment-value'])assert.ok(item.launches.some(launch=>launch.source===bridge&&launch.uncertainties.includes(reason)),reason);
assert.ok(report.warnings.some(warning=>warning.file===fixture&&warning.reason==='runtime-registration'&&warning.scope==='global'));
assert.equal(diagnostic.omissionAuthority,false);assert.equal(diagnostic.closedWorld,false);
const reportBytes=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(reportBytes)<=8*1024**2);
fs.mkdirSync(directory,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(directory,'mappings.json'),reportBytes,{flag:'wx',mode:0o600});
const assessment={schemaVersion:1,kind:'pinned-rea-process-diagnosis',complete:true,upstreamRevision:revision,sourceHashes,reportSha256:digest(reportBytes),reportBytes:Buffer.byteLength(reportBytes),elapsedMs:performance.now()-start,fixture,bridge,excludedConsumer:consumer,falseConsumerRejected:fake,sourceBoundLaunchCandidates:item.launches.length,discoveredConsumerCandidates:item.discoveredConsumerCandidates.length,excludedConsumerCandidates:item.excludedConsumerCandidates.length,omissionAuthority:false,safeOmissionsObserved:false,speedAdvantageClaim:false,executionObserved:false,scope:'Static source and graph diagnosis within original three-project native discovery. Independent full-shadow qualification is separate; no selective tests execute here.',nextAction:item.nextAction};
fs.writeFileSync(path.join(directory,'assessment.json'),JSON.stringify(assessment,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({complete:true,fixture,sourceBoundLaunchCandidates:item.launches.length,omissionAuthority:false}));
