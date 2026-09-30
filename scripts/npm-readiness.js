#!/usr/bin/env node
// Read-only operational diagnostics. This script never logs in, grants access or publishes.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export function npmReadiness({cliVersion,identity,metadata,environment,mainRevision,sourceRevision}) {
  const version=/^(\d+)\.(\d+)\.(\d+)$/.exec(cliVersion || ''), numbers=version?.slice(1).map(Number);
  const oidcCliSupported=!!numbers&&(numbers[0]>11||(numbers[0]===11&&(numbers[1]>5||(numbers[1]===5&&numbers[2]>=1))));
  const packageObserved=metadata?.name==='testlore';
  const protectedEnvironment=environment?.name==='npm-alpha' && environment.protection_rules?.some(r=>r.type==='required_reviewers'&&r.reviewers?.length>0)===true && environment.protection_rules?.some(r=>r.type==='branch_policy')===true;
  const exactMain=/^[a-f0-9]{40}$/.test(sourceRevision || '') && mainRevision===sourceRevision;
  const blockers=[];
  if(!oidcCliSupported)blockers.push('npm-cli-oidc-support-unverified');
  if(identity!==true)blockers.push('interactive-npm-identity-unavailable');
  if(!packageObserved)blockers.push('public-package-not-observed-bootstrap-required');
  if(!protectedEnvironment)blockers.push('protected-github-environment-unverified');
  if(!exactMain)blockers.push('source-is-not-current-main');
  // npm whoami is interactive authentication only; it cannot test a CI OIDC mapping.
  blockers.push('npm-trusted-publisher-and-direct-publish-permission-require-account-verification');
  return {schemaVersion:1,kind:'read-only-npm-readiness',ready:false,oidcCliSupported,interactiveIdentityAvailable:identity===true,publicPackageObserved:packageObserved,protectedEnvironment,exactMain,blockers,
    publisher:{owner:'rudycelekli',repository:'testlore',workflow:'alpha-release.yml',environment:'npm-alpha',allowedAction:'npm publish'},
    nextActions:[...(!packageObserved?['Use maintainer npm access to establish ownership and first-package bootstrap; do not infer name availability from a public 404.']:[]),'Configure or verify the exact trusted publisher on npmjs.com; new mappings must explicitly allow npm publish.','Dispatch the protected exact-SHA workflow only after qualification and publisher verification.'],
    limitations:['Read-only diagnostics, not a release seal or proof of package ownership.','Interactive npm authentication does not establish CI OIDC readiness.','The npm account mapping and publishing permission are not exposed by these probes; no readiness claim is inferred.']};
}
function invoke(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',shell:false,timeout:15000,maxBuffer:256*1024});return {ok:!result.error&&result.status===0,output:result.stdout?.trim()||''};}
function json(result){try{return result.ok?JSON.parse(result.output):null;}catch{return null;}}
export function main(argv=process.argv.slice(2)) {
  if(argv.length)throw new Error('npm-readiness takes no arguments and never publishes');
  const cli=invoke('npm',['--version']),identity=invoke('npm',['whoami','--registry=https://registry.npmjs.org']),metadata=invoke('npm',['view','testlore','--json','--registry=https://registry.npmjs.org']);
  const environment=invoke('gh',['api','repos/rudycelekli/testlore/environments/npm-alpha']),main=invoke('git',['ls-remote','origin','refs/heads/main']),source=invoke('git',['rev-parse','HEAD']);
  const receipt=npmReadiness({cliVersion:cli.output,identity:identity.ok,metadata:json(metadata),environment:json(environment),mainRevision:main.output.split(/\s/)[0],sourceRevision:source.output});
  console.log(JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))) {try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
