import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderRunReport} from './run-report.js';
import {git,safePath} from './files.js';
import {digest} from './provenance.js';
import {captureRepairChallenges,captureChallengeRuntime,assessRepairChallenges} from './repair-challenges.js';
import {verifyAppliedRepairValidation} from './repair-candidates.js';
import {summarizeTypecheck} from './typecheck-report.js';

// Advisory reviewer approval and suite-only receipts cannot qualify source
// repair publication. Reconcile actual controller observations, then rebind the
// immutable oracle, executable and exact source at every publication boundary.
function repairPublicationGuard(worktree,result) {
  const evidence=result.validation?.challenges;
  if(evidence?.accepted!==true||!assessRepairChallenges(evidence.baseline,evidence.candidate).accepted||
    !assessRepairChallenges(result.challengePreflight,evidence.baseline).accepted||
    !assessRepairChallenges(evidence.candidate,[result.finalChallenges,result.finalChallenges]).accepted)
    throw new Error('Source repair publication requires repeated independent regression challenges');
  const verified=verifyAppliedRepairValidation(worktree,result.candidate?.candidatePath);
  if(digest(result.validation)!==digest(verified.receipt))
    throw new Error('Public repair validation differs from the authenticated local receipt');
  if(verified.manifest.typecheck){
    const final=summarizeTypecheck(result.fullRun?.typecheck);
    if(final.status!=='passed'||!final.complete)throw Error('Source repair publication requires completed final TypeScript verification');
    const typed=result.fullRun.typecheck,source=typed.binding?.source?.files;
    if(!Array.isArray(source))throw Error('Final TypeScript source binding required');
    for(const [file,value]of Object.entries(verified.manifest.state.scope.files)){
      const expected=verified.manifest.files.find(item=>item.path===file)?.hash??value.hash;
      if(source.find(item=>item.file===file&&item.kind==='file')?.sha256!==expected)throw Error('Final TypeScript source differs from validated repair');
    }
    if(digest(typed.compiler)!==digest(verified.receipt.typecheck.candidate[0].compiler)||
      digest(typed.binding.node)!==digest(verified.receipt.typecheck.candidate[0].binding.node)||
      digest(typed.binding.producers)!==digest(verified.receipt.typecheck.candidate[0].binding.producers)||
      typed.binding.dependencies.sha256!==verified.receipt.typecheck.candidate[0].binding.dependencies.sha256)
      throw Error('Final TypeScript compiler identities differ from validated repair');
  }
  const expected=result.finalChallenges;
  const definition=captureRepairChallenges(worktree);
  if(definition.status!=='configured'||definition.identity!==expected.identity||
    digest(captureChallengeRuntime())!==digest(expected.runtime)||
    digest(definition.cases.map(item=>[item.id,item.sha256]))!==digest(expected.runs.map(item=>[item.id,item.scriptSha256])))
    throw new Error('Repair challenge oracle or runtime changed before publication');
  const source=expected.source.map(item=>{
    const full=safePath(worktree,item.file),stat=fs.lstatSync(full);
    if(!stat.isFile()||stat.size>65536)throw new Error('Repair challenge source changed before publication');
    const bytes=fs.readFileSync(full);return {file:item.file,sha256:digest(bytes),bytes:bytes.length};
  });
  if(digest(source)!==digest(expected.source))throw new Error('Repair challenge source changed before publication');
}

const expectedPullRequestUrl=(url,repository)=>typeof url==='string'&&url.startsWith(`https://github.com/${repository}/pull/`)&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url);
export function verifyPullRequestMetadata(value,{repository,sha,branch,base}){
  if(!value||typeof value!=='object'||Array.isArray(value)||!expectedPullRequestUrl(value.url,repository))throw new Error('Pull request metadata does not identify the expected GitHub repository');
  if(value.headRefOid!==sha||value.headRefName!==branch||value.baseRefName!==base)throw new Error('Pull request metadata differs from the tested commit, head or base');
  if(value.state!=='OPEN'||typeof value.isDraft!=='boolean')throw new Error('Pull request is not verified open with known draft state');
  return {url:value.url,headRefOid:value.headRefOid,headRefName:value.headRefName,baseRefName:value.baseRefName,state:value.state,isDraft:value.isDraft};
}

export function publishImprovement(root, result, options = {}) {
  if(result.status!=='ready-for-review'||result.validation?.accepted!==true||result.fullRun?.complete!==true||result.fullRun?.exitCode!==0||!result.fullRun?.tests?.some(t=>t.status==='passed')||!result.sha||!result.branch||!result.worktree)throw new Error('Only a tested improvement commit can open a pull request');
  const worktree=result.worktree;
  const repair=result.kind==='source-repair';
  if(repair)repairPublicationGuard(worktree,result);
  if(!new RegExp(`^tddswarm/${repair?'repair':'improve'}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$`).test(result.branch))throw new Error('Invalid improvement branch');
  if(result.sourceHead!==undefined&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.sourceHead))throw new Error('Invalid original source head for pull request receipt');
  const prefix=git(worktree,['rev-parse','--show-prefix']).trim();
  const metadata=line=>{if(line.slice(0,2)!=='??')return false;const file=line.slice(3);const local=prefix&&file.startsWith(prefix)?file.slice(prefix.length):file;
    if(local==='.tddswarm'||local.startsWith('.tddswarm/'))return true;
    // Repair admission above authenticates the full installed tree at every
    // boundary. Physical typed-repair copies need the same metadata treatment
    // as shared installations without hiding a changed dependency byte.
    if(repair&&(local==='node_modules'||local.startsWith('node_modules/'))){try{if(fs.lstatSync(path.join(worktree,'node_modules')).isDirectory())return true;}catch{}}
    if(local==='node_modules'){try{return fs.lstatSync(path.join(worktree,'node_modules')).isSymbolicLink()&&fs.realpathSync(path.join(worktree,'node_modules'))===fs.realpathSync(path.join(root,'node_modules'));}catch{}}return false;};
  function exactState(){
    if(repair)repairPublicationGuard(worktree,result);
    if(git(worktree,['rev-parse',`refs/heads/${result.branch}`]).trim()!==result.sha)throw new Error('Improvement branch changed after validation');
    if(git(worktree,['rev-parse','HEAD']).trim()!==result.sha)throw new Error('Improvement commit changed after validation');
    const status=git(worktree,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0').filter(Boolean);
    if(status.some(line=>!metadata(line)))throw new Error('Improvement worktree changed after validation');
  }
  exactState();
  const remote=options.remote||'origin';
  if(!/^[A-Za-z0-9._-]+$/.test(remote)||remote.startsWith('-'))throw new Error('Invalid remote name');
  const url=git(root,['remote','get-url',remote]).trim();
  const pushUrl=git(worktree,['remote','get-url','--push',remote]).trim();
  const match=url.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if(!match)throw new Error('Automatic pull requests require a configured GitHub remote');
  const existing=options.pullRequest||result.pullRequest;
  if(existing&&!expectedPullRequestUrl(existing,match[1]))throw new Error('Existing pull request URL does not identify the expected GitHub repository');
  const base=options.baseBranch||result.baseBranch;
  if(!base||base.startsWith('-'))throw new Error('A named base branch is required for a pull request');
  git(root,['check-ref-format','--branch',base]);
  const command=options.command||['gh'];
  if(!Array.isArray(command)||!command.length||command.some(s=>typeof s!=='string'||!s))throw new Error('GitHub CLI command must be argv');
  function invoke(args){const response=spawnSync(command[0],[...command.slice(1),...args],{cwd:worktree,encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024});if(response.error||response.status!==0)throw new Error(response.error?.message||`GitHub CLI failed (${response.status}): ${(response.stderr||'').slice(0,2000)}`);return response.stdout.trim();}
  // Check authenticated access before publishing the branch. Never initiate login or change remotes.
  invoke(['repo','view',match[1],'--json','nameWithOwner']);
  exactState();
  if(git(root,['remote','get-url',remote]).trim()!==url||git(worktree,['remote','get-url','--push',remote]).trim()!==pushUrl)throw new Error('Improvement remote changed during authentication');
  // A moving branch must never substitute an untested commit during push/hooks.
  const remoteRef=`refs/heads/${result.branch}`;
  const pushed=spawnSync('git',['-C',worktree,'push',remote,`${result.sha}:${remoteRef}`],{encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024});
  if(pushed.error||pushed.status!==0)throw new Error(pushed.error?.message||`Git push failed (${pushed.status}): ${(pushed.stderr||'').slice(0,2000)}`);
  function exactPublishedState(){
    const verification=spawnSync('git',['-C',worktree,'ls-remote','--heads',pushUrl,remoteRef],{encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024});
    if(verification.error||verification.status!==0)throw new Error(verification.error?.message||'Published remote commit could not be verified');
    const published=verification.stdout.trim().split(/\s+/);
    if(published[0]!==result.sha||published[1]!==remoteRef)throw new Error('Published remote branch differs from the tested improvement commit');
  }
  exactPublishedState();
  exactState();
  const directory=safePath(worktree,'.tddswarm');fs.mkdirSync(directory,{recursive:true});
  const body=path.join(directory,'pull-request.md');
  const full=result.fullRun||result.execution||result.finalRun||result.run||{};
  const cases=full.tests||[];const defects=result.validation.defects||[];
  const summary=`${cases.filter(t=>t.status==='passed').length} passed cases, ${cases.filter(t=>t.status==='skipped').length} skipped. Full file scope: ${(full.discovery?.files||full.executedFiles||[]).join(', ')||'see receipt'}. Held-out defects: ${defects.filter(d=>d.demonstrated&&d.caught).length}/${defects.length} (zero means unmeasured).`; 
  const investigation=result.investigation?`\n\nAn approved historical probe exposed a gap while the original native suite was green. The branch adds ${result.investigation.regressionTest} as a new contract-derived regression. Two original green runs and two augmented failure runs preceded source repair; original assertions stayed unchanged. Recipe ${result.investigation.recipeId}; finding ${result.investigation.findingId}; report SHA-256 ${result.investigation.reportSha256}. Module replay does not establish full dependency coverage or general discovery improvement.`:'';
  const introduction=repair?`TestLore proposes a bounded source repair against the original assertions.${investigation}\n\nThe original assertions were retained unchanged. Repeated baseline and candidate runs in disposable copies evaluated whether the source change repaired the observed failure; the repair branch then ran the full discovered suite before this commit. Independently maintained behavioral challenges passed twice on unchanged source, twice on the candidate, and again on the final branch. Their oracle, runtime and source bindings were rechecked before publication.\n\nSource changes: ${(result.files||result.changedFiles||result.patch?.files||[]).map(file=>typeof file==='string'?file:file.path).filter(Boolean).join(', ')||'see retained source-repair receipt'}. Baseline runs: ${(result.validation.baselineRuns||result.validation.baseline||[]).length||'see receipt'}; candidate runs: ${(result.validation.candidateRuns||[]).length||'see receipt'}. Challenges: ${result.finalChallenges.runs.map(item=>item.id).join(', ')}. The receipt binds the tested source and unchanged original assertions. A passing candidate does not establish behavior outside those observations.`:`TestLore proposes reviewed test improvements and an ongoing quality layer.\n\nThe original and candidate suites were validated in disposable copies; the improvement branch then ran the full discovered suite before this commit.`;
  const policy=repair?'The existing test and deployment policy is preserved. Review the source change and retained failure evidence before merging; unobserved dependencies and outcomes remain uncertain.':'New workflows run a scoped audit and shadow validation on pull requests, and full tests on default-branch pushes. Existing project policy is preserved. Static grades and exercised traces do not certify all possible behavior.';
  const dedupeMarker=result.sourceHead?`<!-- testlore-source-head:${result.sourceHead} -->\n\n`:'';
  fs.writeFileSync(body,`${dedupeMarker}${introduction}\n\nValidation: ${summary} Commit ${result.sha}. See the retained local ${repair?'source-repair':'improvement'} receipt for exact scope, held-out checks and limitations.\n\n${policy}\n\n${renderRunReport({...full,executedFiles:full.executedFiles||full.collectionFiles,plan:full.plan||{mode:'full',total:full.executedFiles?.length||0,selected:full.executedFiles||full.collectionFiles||[],decisions:(full.executedFiles||full.collectionFiles||[]).map(test=>({test,reasons:[repair?'full source-repair validation':'full improvement validation']})),warnings:[]}})}\n`);
  const output=existing||invoke(['pr','create','--repo',match[1],'--head',result.branch,'--base',base,'--title',options.title||(repair?'Repair the verified source failure with TestLore':'Improve test quality with TestLore'),'--body-file',body]);
  const pullRequest=output.split(/\s+/).find(s=>/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(s));
  if(!pullRequest)throw new Error('GitHub CLI did not return a pull request URL; inspect the published branch before retrying');
  if(!expectedPullRequestUrl(pullRequest,match[1]))throw new Error('Created pull request URL does not identify the expected GitHub repository');
  let prMetadata;try{prMetadata=JSON.parse(invoke(['pr','view',pullRequest,'--repo',match[1],'--json','url,headRefOid,headRefName,baseRefName,state,isDraft']));}catch(error){throw new Error('Published pull request metadata could not be verified: '+error.message);}
  const verified=verifyPullRequestMetadata(prMetadata,{repository:match[1],sha:result.sha,branch:result.branch,base});
  if(verified.url!==pullRequest)throw new Error('GitHub CLI returned metadata for a different pull request');
  if(git(root,['remote','get-url',remote]).trim()!==url||git(worktree,['remote','get-url','--push',remote]).trim()!==pushUrl)throw new Error('Improvement remote changed during pull request verification');
  exactState();exactPublishedState();
  return {...result,pullRequest:verified.url,pullRequestVerification:verified,published:true};
}
