import test from 'node:test';
import assert from 'node:assert/strict';
import {npmReadiness,inspectTrustListing} from '../scripts/npm-readiness.js';
const sha='a'.repeat(40),environment={name:'npm-alpha',protection_rules:[{type:'required_reviewers',reviewers:[{type:'User'}]},{type:'branch_policy'}]};
test('npm diagnostics never turn CLI identity or public metadata into publishing authority',()=>{
  const r=npmReadiness({cliVersion:'11.5.1',identity:true,metadata:{name:'testlore'},environment,sourceRevision:sha,mainRevision:sha});
  assert.equal(r.ready,false);assert.equal(r.exactMain,true);assert.equal(r.protectedEnvironment,true);
  assert.deepEqual(r.blockers,['npm-trusted-publisher-and-direct-publish-permission-require-account-verification']);
  assert.equal(r.publisher.allowedAction,'npm publish');
  assert.equal(r.publisher.npmOwner,null);assert.equal(r.publisher.npmOwnershipVerified,false);
  assert.equal(r.publisher.ownerKind,'github-repository-owner');
  assert.equal(r.publisherConfigurationCliSupported,false);
  assert.equal(npmReadiness({cliVersion:'11.15.0'}).publisherConfigurationCliSupported,true);
});
test('missing identity, older CLI, wrong main and unprotected environment remain actionable blockers',()=>{
  const r=npmReadiness({cliVersion:'11.5.0',identity:false,metadata:null,environment:{name:'npm-alpha'},sourceRevision:sha,mainRevision:'b'.repeat(40)});
  assert.equal(r.ready,false);assert.equal(r.blockers.length,6);assert.equal(r.publicPackageObserved,false);assert.match(r.nextActions[0],/bootstrap/);
  assert.equal(npmReadiness({cliVersion:'12.0.0'}).oidcCliSupported,true);
  assert.equal(npmReadiness({cliVersion:'not a version'}).oidcCliSupported,false);
});
const trust={type:'github',repository:'rudycelekli/testlore',file:'alpha-release.yml',environment:'npm-alpha',permissions:['createPackage']};
const observed={cliVersion:'11.15.0',identity:true,identityAccount:'rudycelekli',metadata:{name:'testlore',maintainers:[{name:'rudycelekli'}]},environment,sourceRevision:sha,mainRevision:sha,trustListing:{ok:true,output:JSON.stringify(trust)}};
test('authenticated exact trust listing identifies the protected next action without claiming release authority',()=>{
  const r=npmReadiness(observed);
  assert.equal(r.trustedPublisherObserved,true);assert.equal(r.trustListingStatus,'observed');assert.equal(r.protectedWorkflowPrerequisitesObserved,true);
  assert.deepEqual(r.blockers,[]);assert.equal(r.ready,false);assert.equal(r.publisher.oidcExchangeVerified,false);assert.equal(r.publisher.npmOwnershipVerified,false);
  assert.equal(r.publicMaintainerObserved,true);assert.equal(r.npmAccount,'rudycelekli');
  assert.equal(npmReadiness({...observed,metadata:{name:'testlore',maintainers:['rudycelekli <public@example.invalid>']}}).publicMaintainerObserved,true);
  for(const maintainers of [{name:'rudycelekli'},['other <public@example.invalid>'],['rudycelekli-other <public@example.invalid>']])assert.equal(npmReadiness({...observed,metadata:{name:'testlore',maintainers}}).publicMaintainerObserved,false);
});
test('wrong account, publisher claims, direct permission and unsuccessful listing fail closed',()=>{
  for(const change of [{type:'gitlab'},{repository:'other/testlore'},{file:'other.yml'},{environment:'other'},{permissions:['createStagedPackage']},{permissions:'createPackage'}]){
    assert.equal(npmReadiness({...observed,trustListing:{ok:true,output:JSON.stringify({...trust,...change})}}).trustedPublisherObserved,false);
  }
  for(const change of [{identity:false},{identityAccount:'someoneelse'},{identityAccount:undefined},{cliVersion:'11.6.1'},{trustListing:{ok:false,output:JSON.stringify(trust)}}])assert.equal(npmReadiness({...observed,...change}).trustedPublisherObserved,false);
  assert.equal(npmReadiness({...observed,identityAccount:'someoneelse'}).blockers.includes('npm-account-is-not-requested-maintainer'),true);
});
test('listing decoding is bounded and refuses unfamiliar output without echoing arbitrary fields',()=>{
  for(const input of ['bad',JSON.stringify(null),JSON.stringify('string'),JSON.stringify(Array(9).fill(trust)),JSON.stringify([trust,{}]),JSON.stringify([trust,{type:'github',permissions:[null]}]),' '.repeat(32769),JSON.stringify(trust)+'\n'+JSON.stringify(trust)])assert.equal(inspectTrustListing(input),null);
  assert.deepEqual(inspectTrustListing('[]'),{count:0,exactMapping:false});
  assert.deepEqual(inspectTrustListing(JSON.stringify([trust])),{count:1,exactMapping:true});
  const r=npmReadiness({...observed,trustListing:{ok:true,output:JSON.stringify({...trust,unknown:'DO_NOT_ECHO'})}});
  assert.doesNotMatch(JSON.stringify(r),/DO_NOT_ECHO/);
  assert.equal(npmReadiness({...observed,identityAccount:'unsafe\noutput'}).npmAccount,null);
});
