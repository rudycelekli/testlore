import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {git,safePath} from './files.js';

export function publishImprovement(root, result, options = {}) {
  if(result.status!=='ready-for-review'||result.validation?.accepted!==true||result.fullRun?.complete!==true||result.fullRun?.exitCode!==0||!result.fullRun?.tests?.some(t=>t.status==='passed')||!result.sha||!result.branch||!result.worktree)throw new Error('Only a tested improvement commit can open a pull request');
  const worktree=result.worktree;
  if(!/^tddswarm\/improve-[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(result.branch))throw new Error('Invalid improvement branch');
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
  const verification=spawnSync('git',['-C',worktree,'ls-remote','--heads',pushUrl,remoteRef],{encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024});
  if(verification.error||verification.status!==0)throw new Error(verification.error?.message||'Published remote commit could not be verified');
  const published=verification.stdout.trim().split(/\s+/);
  if(published[0]!==result.sha||published[1]!==remoteRef)throw new Error('Published remote branch differs from the tested improvement commit');
  exactState();
  const directory=safePath(worktree,'.tddswarm');fs.mkdirSync(directory,{recursive:true});
  const body=path.join(directory,'pull-request.md');
  const full=result.fullRun||result.execution||result.finalRun||result.run||{};
  const cases=full.tests||[];const defects=result.validation.defects||[];
  const summary=`${cases.filter(t=>t.status==='passed').length} passed cases, ${cases.filter(t=>t.status==='skipped').length} skipped. Full file scope: ${(full.discovery?.files||full.executedFiles||[]).join(', ')||'see receipt'}. Held-out defects: ${defects.filter(d=>d.demonstrated&&d.caught).length}/${defects.length} (zero means unmeasured).`; 
  fs.writeFileSync(body,`TestLore proposes reviewed test improvements and an ongoing quality layer.\n\nThe original and candidate suites were validated in disposable copies; the improvement branch then ran the full discovered suite before this commit.\n\nValidation: ${summary} Commit ${result.sha}. See the retained local improvement receipt for exact scope, held-out checks and limitations.\n\nThe workflow runs a scoped audit and affected tests on pull requests, and full tests on default-branch pushes. Static grades and exercised traces do not certify all possible behavior.\n`);
  const output=invoke(['pr','create','--repo',match[1],'--head',result.branch,'--base',base,'--title',options.title||'Improve test quality with TestLore','--body-file',body]);
  const pullRequest=output.split(/\s+/).find(s=>/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(s));
  if(!pullRequest)throw new Error('GitHub CLI did not return a pull request URL; inspect the published branch before retrying');
  return {...result,pullRequest,published:true};
}
