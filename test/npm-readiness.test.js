import test from 'node:test';
import assert from 'node:assert/strict';
import {npmReadiness} from '../scripts/npm-readiness.js';
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
