import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safePath,readConfig,git} from './files.js';
import {digest} from './provenance.js';
export function defaultNativeAdapter(pkg={}){
 // Integration SDKs may be development dependencies of a Node-test project.
 // Respect an explicit built-in test command before dependency heuristics.
 if(typeof pkg.scripts?.test==='string'&&/^\s*node\s+--test(?:\s|$)/.test(pkg.scripts.test))return 'node';
 const deps={...pkg.dependencies,...pkg.devDependencies};
 return deps.vitest?'vitest':deps.jest?'jest':'node';
}
// Keep generated commands portable between local workstations and CI. A local
// Vitest CLI permits one fresh discovery/resolver context; ancestor-only or
// not-yet-installed dependencies retain npm's existing no-download resolution.
export function defaultNativeRunner(root,adapter){
 if(adapter==='vitest'){
  try{
   const cli=fs.statSync(path.join(root,'node_modules/vitest/vitest.mjs'));
   if(cli.isFile()&&cli.size<=1024*1024)return ['node','node_modules/vitest/vitest.mjs','run','{files}'];
  }catch{}
  return ['npx','--no-install','vitest','run','{files}'];
 }
 return adapter==='jest'?['npx','--no-install','jest','--runTestsByPath','{files}']:['node','--test','{files}'];
}
export function installedActionReference(){
 const packageRoot=fileURLToPath(new URL('../',import.meta.url));
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  for(const value of [manifest._resolved,manifest.gitHead]){if(typeof value==='string'){const match=value.match(/(?:#|^)([a-f0-9]{40})$/);if(match)return match[1];}}
  const parent=path.dirname(packageRoot);
  if(path.basename(parent)==='node_modules'){
   const lock=JSON.parse(fs.readFileSync(path.join(parent,'.package-lock.json'),'utf8'));
   const resolved=lock.packages?.['node_modules/'+path.basename(packageRoot)]?.resolved;
   const match=typeof resolved==='string'&&resolved.match(/github\.com[/:]rudycelekli\/(?:testlore|tddswarm)(?:\.git)?#([a-f0-9]{40})$/);if(match)return match[1];
  }
 }catch{}
 try{if(fs.realpathSync(git(packageRoot,['rev-parse','--show-toplevel']).trim())===fs.realpathSync(packageRoot)&&!git(packageRoot,['status','--porcelain']).trim())return git(packageRoot,['rev-parse','HEAD']).trim();}catch{}
 return 'main';
}
function policy(options){
 const reference=options.actionRef||installedActionReference(),defaultBranch=options.defaultBranch||'main';
 if(!/^[A-Za-z0-9._/-]+$/.test(reference)||reference.includes('..'))throw new Error('Invalid action reference');
 if(!/^[A-Za-z0-9._/-]+$/.test(defaultBranch)||defaultBranch.includes('..'))throw new Error('Invalid default branch');
 return {reference,defaultBranch};
}
function repositoryRoot(root){try{return fs.realpathSync(git(root,['rev-parse','--show-toplevel']).trim());}catch{return fs.realpathSync(root);}}

export function installQualityWorkflow(root,options={}){
 root=fs.realpathSync(root);const {reference,defaultBranch}=policy(options);
 if(repositoryRoot(root)!==root)throw new Error('Quality workflows must be installed at the Git repository root');
 const project=options.project||'.';const projectRoot=project==='.'?root:safePath(root,project);
 if(!fs.statSync(projectRoot).isDirectory())throw new Error('Quality project must be an existing directory');
 const workflow=`.github/workflows/tddswarm${project==='.'?'':'-'+digest(project).slice(0,8)}.yml`;
 const target=safePath(root,workflow);if(fs.existsSync(target))return [];
 const config=readConfig(projectRoot);
 // Workspace installs use the repository's lockfile and project-local execution scope.
 const dependencyRoot=['package-lock.json','pnpm-lock.yaml','yarn.lock'].some(f=>fs.existsSync(safePath(root,f)))?root:projectRoot;
 const dependencyDirectory=path.relative(root,dependencyRoot).split(path.sep).join('/')||'.';
 const dependencyCommand=fs.existsSync(safePath(dependencyRoot,'package-lock.json'))?'npm ci --ignore-scripts':fs.existsSync(safePath(dependencyRoot,'pnpm-lock.yaml'))?'corepack enable && pnpm install --frozen-lockfile --ignore-scripts':fs.existsSync(safePath(dependencyRoot,'yarn.lock'))?'corepack enable && yarn install --immutable':fs.existsSync(safePath(dependencyRoot,'package.json'))?'npm install --ignore-scripts':null;
 const dependencies=dependencyCommand?`      - name: Install project dependencies\n        working-directory: ${JSON.stringify(dependencyDirectory)}\n        run: ${dependencyCommand}\n`:'';
 const external=config.integration?'      # Configure your native Python/Nx/Bazel dependencies here before the action.\n':'';
 const text=`# Generated on a tested TestLore improvement branch. Pin the action ref after review.
name: TestLore quality engineer
on:
  pull_request:
  push:
    branches: [${JSON.stringify(defaultBranch)}]
permissions:
  contents: read
concurrency:
  group: tddswarm-${digest(project).slice(0,8)}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
${dependencies}${external}      - name: Assess quality and execute tests for the change
        uses: rudycelekli/testlore@${reference}
        with:
          root: ${JSON.stringify(project)}
          base: \${{ github.event.pull_request.base.sha || github.event.before || github.sha }}
          mode: \${{ github.event_name == 'pull_request' && 'shadow' || 'full' }}
          environment: node22-linux
          audit: 'true'
`;
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);return [workflow];
}

// Add configuration in the project scope; CI lives at the repository root.
export function installQualityLayer(root,options={}){
 root=fs.realpathSync(root);policy(options);
 if(options.ci!==false&&repositoryRoot(root)!==root)throw new Error('For nested projects install configuration with ci:false and use installQualityWorkflow at the repository root');
 const written=[];const configPath=safePath(root,'tddswarm.config.json');
 if(!fs.existsSync(configPath)){
  let pkg={};try{pkg=JSON.parse(fs.readFileSync(safePath(root,'package.json'),'utf8'));}catch{}
  const adapter=defaultNativeAdapter(pkg);
  const runner=defaultNativeRunner(root,adapter);
  fs.writeFileSync(configPath,JSON.stringify({adapter,discovery:'native',executionMode:'shadow',runner,analysisCache:{enabled:true},alwaysRun:[],dependencies:{},ignoreChanges:[],fullRunEvery:20},null,2)+'\n');written.push('tddswarm.config.json');
 }
 const ignorePath=safePath(root,'.gitignore');let ignore=fs.existsSync(ignorePath)?fs.readFileSync(ignorePath,'utf8'):'';let amended=false;
 for(const directory of ['.tddswarm','node_modules'])if(!ignore.split(/\r?\n/).some(s=>[directory,directory+'/', '/'+directory+'/'].includes(s.trim()))){ignore+=(ignore&&!ignore.endsWith('\n')?'\n':'')+directory+'/\n';amended=true;}
 if(amended){fs.writeFileSync(ignorePath,ignore);written.push('.gitignore');}
 if(options.ci!==false)written.push(...installQualityWorkflow(root,options));return written;
}

export function assertAutofixPrerequisites(root,config=readConfig(root),options={}){
 if(!/^[a-f0-9]{40}$/.test(policy(options).reference))throw new Error('Autofix requires --action-ref with an exact reviewed 40-character commit SHA');
 if(repositoryRoot(root)!==fs.realpathSync(root))throw new Error('Autofix workflow setup currently requires the repository root');
 if(!Array.isArray(config.agent)||!config.agent.length)throw new Error('Autofix requires an explicit agent argv available on a trusted self-hosted runner');
 if(!Array.isArray(config.repair?.sourcePaths)||!config.repair.sourcePaths.length||config.repair.sourcePaths.length>32)throw new Error('Autofix requires reviewed repair.sourcePaths (1–32 existing production files)');
 const requirements=safePath(root,'tddswarm.requirements.md');
 if(!fs.existsSync(requirements)||fs.statSync(requirements).size>65536||!fs.readFileSync(requirements,'utf8').trim())throw new Error('Autofix requires independent tddswarm.requirements.md (at most 64 KiB)');
 for(const file of config.repair.sourcePaths){const target=safePath(root,file);if(!/^(?:src|lib|app)\//.test(file)||!fs.statSync(target).isFile())throw new Error(`Invalid autofix source scope: ${file}`);}
 return true;
}

/** Explicit opt-in only. No privileged fork-PR trigger or implicit scheduler. */
export function installAutofixWorkflow(root,options={}){
 root=fs.realpathSync(root);assertAutofixPrerequisites(root,readConfig(root),options);
 const {reference,defaultBranch}=policy(options);
 if(!/^[a-f0-9]{40}$/.test(reference))throw new Error('Autofix requires --action-ref with an exact reviewed 40-character commit SHA');
 const target=safePath(root,'.github/workflows/testlore-autofix.yml');
 if(fs.existsSync(target))return [];
 const dependencyCommand=fs.existsSync(safePath(root,'package-lock.json'))?'npm ci --ignore-scripts':fs.existsSync(safePath(root,'pnpm-lock.yaml'))?'corepack enable && pnpm install --frozen-lockfile --ignore-scripts':fs.existsSync(safePath(root,'yarn.lock'))?'corepack enable && yarn install --immutable --mode=skip-builds':'npm install --ignore-scripts';
 const text=`# Opt-in trusted agent execution. Configure a self-hosted runner labeled testlore.
# The configured worker must already be authenticated. This workflow never merges PRs.
name: TestLore bounded agent improvements
on:
  push:
    branches: [${JSON.stringify(defaultBranch)}]
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
concurrency:
  group: testlore-autofix
  cancel-in-progress: false
jobs:
  improve:
    if: github.ref == '${'refs/heads/'+defaultBranch}'
    runs-on: [self-hosted, testlore]
    timeout-minutes: 20
    env:
      GH_TOKEN: \${{ github.token }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22.19.0'
      - name: Bind identity for the review branch
        run: |
          git config user.name 'TestLore quality agent'
          git config user.email 'testlore@users.noreply.github.com'
      - name: Avoid duplicate PRs for the same original revision
        id: pending
        env:
          REPO: \${{ github.repository }}
        run: |
          gh api --paginate --slurp "repos/$REPO/pulls?state=open&per_page=100" > "$RUNNER_TEMP/testlore-open-prs.json"
          node --input-type=module -e 'import fs from "node:fs";import {execFileSync} from "node:child_process";const text=fs.readFileSync(process.env.RUNNER_TEMP+"/testlore-open-prs.json","utf8");const pages=JSON.parse(text).flat();const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();const pending=pages.some(pr=>pr.head?.ref?.startsWith("tddswarm/")&&pr.body?.includes("<!-- testlore-source-head:"+sha+" -->"));fs.appendFileSync(process.env.GITHUB_OUTPUT,"exists="+pending+"\\n");'
      - name: Install original project dependencies
        if: steps.pending.outputs.exists != 'true'
        run: ${dependencyCommand}
      - name: Install the exact reviewed TestLore revision
        if: steps.pending.outputs.exists != 'true'
        run: npm install --prefix "$RUNNER_TEMP/testlore-autofix" --ignore-scripts --omit=dev --no-audit --no-fund 'git+https://github.com/rudycelekli/testlore.git#${reference}'
      - name: Find, delegate, validate and open a review PR
        if: steps.pending.outputs.exists != 'true'
        run: node "$RUNNER_TEMP/testlore-autofix/node_modules/testlore/src/cli.js" autopilot --deadline-ms 900000 --json > "$RUNNER_TEMP/testlore-autofix-result.json"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: testlore-agent-evidence-\${{ github.sha }}
          path: |
            \${{ runner.temp }}/testlore-autofix-result.json
            \${{ runner.temp }}/testlore-repair-*/.tddswarm/repair/
          include-hidden-files: true
`;
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text,{flag:'wx'});return ['.github/workflows/testlore-autofix.yml'];
}
