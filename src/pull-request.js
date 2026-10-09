import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderRunReport} from './run-report.js';
import {git,safePath} from './files.js';

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
  if(!new RegExp(`^tddswarm/${repair?'repair':'improve'}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$`).test(result.branch))throw new Error('Invalid improvement branch');
  if(result.sourceHead!==undefined&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.sourceHead))throw new Error('Invalid original source head for pull request receipt');
  const prefix=git(worktree,['rev-parse','--show-prefix']).trim();
  const metadata=line=>{if(line.slice(0,2)!=='??')return false;const file=line.slice(3);const local=prefix&&file.startsWith(prefix)?file.slice(prefix.length):file;
    if(local==='.tddswarm'||local.startsWith('.tddswarm/'))return true;
    if(local==='node_modules'){try{return fs.lstatSync(path.join(worktree,'node_modules')).isSymbolicLink()&&fs.realpathSync(path.join(worktree,'node_modules'))===fs.realpathSync(path.join(root,'node_modules'));}catch{}}return false;};
  function exactState(){
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
  const introduction=repair?`TestLore proposes a bounded source repair against the original assertions.\n\nThe original assertions were retained unchanged. Repeated baseline and candidate runs in disposable copies evaluated whether the source change repaired the observed failure; the repair branch then ran the full discovered suite before this commit.\n\nSource changes: ${(result.files||result.changedFiles||result.patch?.files||[]).map(file=>typeof file==='string'?file:file.path).filter(Boolean).join(', ')||'see retained source-repair receipt'}. Baseline runs: ${(result.validation.baselineRuns||[]).length||'see receipt'}; candidate runs: ${(result.validation.candidateRuns||[]).length||'see receipt'}. The receipt binds the tested source and unchanged original assertions. A passing candidate does not establish behavior outside those observations.`:`TestLore proposes reviewed test improvements and an ongoing quality layer.\n\nThe original and candidate suites were validated in disposable copies; the improvement branch then ran the full discovered suite before this commit.`;
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
