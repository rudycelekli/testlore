import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {git,safePath} from './files.js';

export function publishImprovement(root, result, options = {}) {
  if(result.status!=='ready-for-review'||result.validation?.accepted!==true||result.fullRun?.complete!==true||result.fullRun?.exitCode!==0||!result.fullRun?.tests?.some(t=>t.status==='passed')||!result.sha||!result.branch||!result.worktree)throw new Error('Only a tested improvement commit can open a pull request');
  const worktree=result.worktree;
  if(git(worktree,['rev-parse','HEAD']).trim()!==result.sha)throw new Error('Improvement commit changed after validation');
  if(git(worktree,['status','--porcelain']).trim())throw new Error('Improvement worktree changed after validation');
  const remote=options.remote||'origin';
  if(!/^[A-Za-z0-9._-]+$/.test(remote)||remote.startsWith('-'))throw new Error('Invalid remote name');
  const url=git(root,['remote','get-url',remote]).trim();
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
  const pushed=spawnSync('git',['-C',worktree,'push','--set-upstream',remote,result.branch],{encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024});
  if(pushed.error||pushed.status!==0)throw new Error(pushed.error?.message||`Git push failed (${pushed.status}): ${(pushed.stderr||'').slice(0,2000)}`);
  const directory=safePath(worktree,'.tddswarm');fs.mkdirSync(directory,{recursive:true});
  const body=path.join(directory,'pull-request.md');
  const full=result.fullRun||result.execution||result.finalRun||result.run||{};
  const cases=full.tests||[];const defects=result.validation.defects||[];
  const summary=`${cases.filter(t=>t.status==='passed').length} passed cases, ${cases.filter(t=>t.status==='skipped').length} skipped. Full file scope: ${(full.discovery?.files||full.executedFiles||[]).join(', ')||'see receipt'}. Held-out defects: ${defects.filter(d=>d.demonstrated&&d.caught).length}/${defects.length} (zero means unmeasured).`; 
  fs.writeFileSync(body,`TDDSwarm proposes reviewed test improvements and an ongoing quality layer.\n\nThe original and candidate suites were validated in disposable copies; the improvement branch then ran the full discovered suite before this commit.\n\nValidation: ${summary} Commit ${result.sha}. See the retained local improvement receipt for exact scope, held-out checks and limitations.\n\nThe workflow runs a scoped audit and affected tests on pull requests, and full tests on default-branch pushes. Static grades and exercised traces do not certify all possible behavior.\n`);
  const output=invoke(['pr','create','--repo',match[1],'--head',result.branch,'--base',base,'--title',options.title||'Improve test quality with TDDSwarm','--body-file',body]);
  const pullRequest=output.split(/\s+/).find(s=>/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(s));
  if(!pullRequest)throw new Error('GitHub CLI did not return a pull request URL; inspect the published branch before retrying');
  return {...result,pullRequest,published:true};
}
