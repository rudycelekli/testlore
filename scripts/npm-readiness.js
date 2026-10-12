#!/usr/bin/env node
// Read-only operational diagnostics. This script never logs in, grants access or publishes.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// npm trust list --json emits these normalized fields (npm CLI TrustGitHub/bodyToOptions).
// Accept only a finite successful listing; unfamiliar or malformed output stays unverified.
export function inspectTrustListing(output) {
  if(typeof output!=='string'||Buffer.byteLength(output)>32768)return null;
  let parsed;try{parsed=JSON.parse(output);}catch{return null;}
  const rows=Array.isArray(parsed)?parsed:[parsed];
  if(rows.length>8||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)||!['github','gitlab','circleci'].includes(r.type)||!Array.isArray(r.permissions)||r.permissions.length>16||r.permissions.some(p=>typeof p!=='string'||p.length>64)))return null;
  return {count:rows.length,exactMapping:rows.some(r=>r.type==='github'&&r.repository==='rudycelekli/testlore'&&r.file==='alpha-release.yml'&&r.environment==='npm-alpha'&&Array.isArray(r.permissions)&&r.permissions.includes('createPackage'))};
}
export function npmReadiness({cliVersion,identity,identityAccount,metadata,environment,mainRevision,sourceRevision,trustListing}) {
  const version=/^(\d+)\.(\d+)\.(\d+)$/.exec(cliVersion || ''), numbers=version?.slice(1).map(Number);
  const oidcCliSupported=!!numbers&&(numbers[0]>11||(numbers[0]===11&&(numbers[1]>5||(numbers[1]===5&&numbers[2]>=1))));
  const publisherConfigurationCliSupported=!!numbers&&(numbers[0]>11||(numbers[0]===11&&numbers[1]>=15));
  const packageObserved=metadata?.name==='testlore';
  const protectedEnvironment=environment?.name==='npm-alpha' && environment.protection_rules?.some(r=>r.type==='required_reviewers'&&r.reviewers?.length>0)===true && environment.protection_rules?.some(r=>r.type==='branch_policy')===true;
  const exactMain=/^[a-f0-9]{40}$/.test(sourceRevision || '') && mainRevision===sourceRevision;
  const account=identity===true&&typeof identityAccount==='string'&&/^[a-z0-9._-]{1,214}$/.test(identityAccount)?identityAccount:null;
  // npm view normalizes registry maintainer objects to "name <email>" strings.
  // Observe only the exact name; never retain or echo public email addresses.
  const publicMaintainerObserved=packageObserved&&Array.isArray(metadata.maintainers)&&metadata.maintainers.some(m=>m?.name==='rudycelekli'||m==='rudycelekli'||(typeof m==='string'&&/^rudycelekli <[^<>\r\n]+>$/.test(m)));
  const trustListingStatus=!publisherConfigurationCliSupported?'cli-version-unsupported':identity!==true?'identity-unavailable':trustListing?.ok===true?'observed':'probe-unavailable';
  const inspected=trustListingStatus==='observed'?inspectTrustListing(trustListing.output):null;
  const trustedPublisherObserved=account==='rudycelekli'&&inspected?.exactMapping===true;
  const blockers=[];
  if(!oidcCliSupported)blockers.push('npm-cli-oidc-support-unverified');
  if(identity!==true)blockers.push('interactive-npm-identity-unavailable');
  if(!packageObserved)blockers.push('public-package-not-observed-bootstrap-required');
  if(!protectedEnvironment)blockers.push('protected-github-environment-unverified');
  if(!exactMain)blockers.push('source-is-not-current-main');
  if(account&&account!=='rudycelekli')blockers.push('npm-account-is-not-requested-maintainer');
  if(!trustedPublisherObserved)blockers.push('npm-trusted-publisher-and-direct-publish-permission-require-account-verification');
  return {schemaVersion:1,kind:'read-only-npm-readiness',ready:false,oidcCliSupported,publisherConfigurationCliSupported,interactiveIdentityAvailable:identity===true,publicPackageObserved:packageObserved,protectedEnvironment,exactMain,blockers,
    npmAccount:account,publicMaintainerObserved,trustListingStatus,trustListingFormatVerified:inspected!==null,trustedPublisherObserved,protectedWorkflowPrerequisitesObserved:blockers.length===0,
    publisher:{owner:'rudycelekli',ownerKind:'github-repository-owner',githubOwner:'rudycelekli',npmOwner:null,npmOwnershipVerified:false,repository:'testlore',workflow:'alpha-release.yml',environment:'npm-alpha',allowedAction:'npm publish',configurationObserved:trustedPublisherObserved,oidcExchangeVerified:false},
    nextActions:[...(!packageObserved?['Use maintainer npm access to establish ownership and first-package bootstrap; do not infer name availability from a public 404.']:[]),...(identity!==true?['Restore npm authentication as rudycelekli without sharing credentials.']:[]),...(!trustedPublisherObserved?['Configure or verify the exact trusted publisher on npmjs.com; new mappings must explicitly allow npm publish.','With authenticated npm >=11.15.0, npm trust list testlore --json is a read-only configuration probe.']:[]),'Dispatch the protected exact-SHA workflow only after qualification and publisher verification; respect its existing environment gate.'],
    limitations:['Read-only diagnostics, not a release seal or proof of package ownership.','Interactive npm authentication and observed trust configuration do not establish a successful CI OIDC exchange or registry publication.','Public maintainer metadata does not establish authenticated package write permission.','Publishing via OIDC requires npm >=11.5.1; trusted-publisher CLI probes require >=11.15.0 and account access. The website is a separate configuration path.','ready remains false because this diagnostic does not verify archive qualification, environment approval or publication; observed prerequisites identify the next gated action.']};
}
function invoke(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',shell:false,stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:256*1024});return {ok:!result.error&&result.status===0,output:result.stdout?.trim()||''};}
function json(result){try{return result.ok?JSON.parse(result.output):null;}catch{return null;}}
export function main(argv=process.argv.slice(2)) {
  if(argv.length)throw new Error('npm-readiness takes no arguments and never publishes');
  const cli=invoke('npm',['--version']),identity=invoke('npm',['whoami','--registry=https://registry.npmjs.org']),metadata=invoke('npm',['view','testlore','--json','--registry=https://registry.npmjs.org']);
  const environment=invoke('gh',['api','repos/rudycelekli/testlore/environments/npm-alpha']),main=invoke('git',['ls-remote','origin','refs/heads/main']),source=invoke('git',['rev-parse','HEAD']);
  const support=npmReadiness({cliVersion:cli.output}).publisherConfigurationCliSupported;
  const trustListing=identity.ok&&support?invoke('npm',['trust','list','testlore','--json','--registry=https://registry.npmjs.org']):null;
  const receipt=npmReadiness({cliVersion:cli.output,identity:identity.ok,identityAccount:identity.output,metadata:json(metadata),environment:json(environment),mainRevision:main.output.split(/\s/)[0],sourceRevision:source.output,trustListing});
  console.log(JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))) {try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
