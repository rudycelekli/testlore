import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safePath,readConfig,git} from './files.js';
import {digest} from './provenance.js';
export function installedActionReference(){
 const packageRoot=fileURLToPath(new URL('../',import.meta.url));
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  for(const value of [manifest._resolved,manifest.gitHead]){if(typeof value==='string'){const match=value.match(/(?:#|^)([a-f0-9]{40})$/);if(match)return match[1];}}
  const parent=path.dirname(packageRoot);
  if(path.basename(parent)==='node_modules'){
   const lock=JSON.parse(fs.readFileSync(path.join(parent,'.package-lock.json'),'utf8'));
   const resolved=lock.packages?.['node_modules/'+path.basename(packageRoot)]?.resolved;
   const match=typeof resolved==='string'&&resolved.match(/github\.com[/:]rudycelekli\/tddswarm(?:\.git)?#([a-f0-9]{40})$/);if(match)return match[1];
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
          mode: \${{ github.event_name == 'pull_request' && 'affected' || 'full' }}
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
  const deps={...pkg.dependencies,...pkg.devDependencies};const adapter=deps.vitest?'vitest':deps.jest?'jest':'node';
  const runner=adapter==='vitest'?['npx','--no-install','vitest','run','{files}']:adapter==='jest'?['npx','--no-install','jest','--runTestsByPath','{files}']:['node','--test','{files}'];
  fs.writeFileSync(configPath,JSON.stringify({adapter,discovery:'native',runner,alwaysRun:[],dependencies:{},ignoreChanges:[],fullRunEvery:20},null,2)+'\n');written.push('tddswarm.config.json');
 }
 const ignorePath=safePath(root,'.gitignore');let ignore=fs.existsSync(ignorePath)?fs.readFileSync(ignorePath,'utf8'):'';let amended=false;
 for(const directory of ['.tddswarm','node_modules'])if(!ignore.split(/\r?\n/).some(s=>[directory,directory+'/', '/'+directory+'/'].includes(s.trim()))){ignore+=(ignore&&!ignore.endsWith('\n')?'\n':'')+directory+'/\n';amended=true;}
 if(amended){fs.writeFileSync(ignorePath,ignore);written.push('.gitignore');}
 if(options.ci!==false)written.push(...installQualityWorkflow(root,options));return written;
}
