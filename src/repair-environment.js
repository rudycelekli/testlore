import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credentialName=name=>/(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key|client[_-]?key|credential|cookie)/i.test(name)||/(?:^|_)(?:auth|authorization|authentication)(?:_|$)/i.test(name)||/^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|GIT_ASKPASS|SSH_ASKPASS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+)$/i.test(name);
const profileName=name=>/^(?:CODEX_.*|CLAUDE_CONFIG_DIR|CLAUDE_HOME|BROWSER_USE_.*|GH_CONFIG_DIR|DOCKER_CONFIG|AWS_CONFIG_FILE|AWS_SHARED_CREDENTIALS_FILE|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CONFIG_DIR|KUBECONFIG|NETRC|CURL_HOME|ZDOTDIR|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM)$/i.test(name);

/**
 * Standard authentication/environment isolation for native repair checks.
 * This is not an OS sandbox: executable code can still read arbitrary paths
 * and access the network. Agent/provider and publication processes stay intact.
 * Callbacks must pass the supplied config to native execution, never return or
 * record config/env. Undefined overrides prevent inherited secrets reappearing
 * when execution.nativeEnvironment merges the host environment.
 */
export function withRepairEnvironment(config,callback) {
  if(!config||typeof config!=='object'||Array.isArray(config)||typeof callback!=='function')throw new Error('Repair environment requires config and callback');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-native-home-'));
  const cleanup=()=>fs.rmSync(home,{recursive:true,force:true});
  try {
    fs.chmodSync(home,0o700);
    const env=Object.create(null);
    for(const [name,value] of Object.entries({...process.env,...config.env}))env[name]=credentialName(name)||profileName(name)?undefined:value;
    const dirs={TMPDIR:'tmp',TMP:'tmp',TEMP:'tmp',XDG_CONFIG_HOME:'config',XDG_DATA_HOME:'data',XDG_CACHE_HOME:'cache',XDG_STATE_HOME:'state',XDG_RUNTIME_DIR:'runtime',NPM_CONFIG_CACHE:'npm-cache',npm_config_cache:'npm-cache'};
    for(const [name,relative] of Object.entries(dirs)){const directory=path.join(home,relative);fs.mkdirSync(directory,{recursive:true,mode:0o700});env[name]=directory;}
    env.HOME=home;env.USERPROFILE=home;env.HOMEDRIVE=undefined;env.HOMEPATH=undefined;
    const npmUser=path.join(home,'npm-user.conf'),npmGlobal=path.join(home,'npm-global.conf'),gitGlobal=path.join(home,'git-global.conf'),gitSystem=path.join(home,'git-system.conf');
    for(const file of [npmUser,npmGlobal,gitGlobal,gitSystem])fs.writeFileSync(file,'',{mode:0o600,flag:'wx'});
    Object.assign(env,{NPM_CONFIG_USERCONFIG:npmUser,npm_config_userconfig:npmUser,NPM_CONFIG_GLOBALCONFIG:npmGlobal,npm_config_globalconfig:npmGlobal,GIT_CONFIG_GLOBAL:gitGlobal,GIT_CONFIG_SYSTEM:gitSystem,GIT_CONFIG_NOSYSTEM:'1'});
    const outcome=callback({...config,env});
    if(outcome&&typeof outcome.then==='function')return Promise.resolve(outcome).finally(cleanup);
    cleanup();return outcome;
  }catch(error){cleanup();throw error;}
}
