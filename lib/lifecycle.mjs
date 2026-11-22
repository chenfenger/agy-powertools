import { existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,readdirSync,lstatSync,unlinkSync,openSync,closeSync,cpSync,rmdirSync } from 'node:fs';
import { join,resolve,relative,dirname,isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { collectPackage,validatePackage,writePackage,sha256 } from './package.mjs';
import { stopRuntimes } from './runtime-control.mjs';
import { configureLaunchers,restoreLaunchers } from './launcher.mjs';

export function installationPaths(home=homedir()){
  const root=join(resolve(home),'.gemini');
  return {home:resolve(home),root,config:join(root,'config','config.json'),installed:join(root,'config','plugins','agy-powertools'),data:join(root,'antigravity','plugin_data','agy-powertools'),sidecars:join(root,'antigravity','sidecar_data','agy-powertools'),brain:join(root,'antigravity','brain')};
}
export function assertOwnedPath(root,target){
  const rel=relative(resolve(root),resolve(target));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('目标路径越界');
  let path=resolve(root);if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('目标目录不能是符号链接');
  for(const part of rel.split(/[\\/]/)){path=join(path,part);if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('目标路径包含符号链接');}
  return resolve(target);
}
function assertTree(path){if(!existsSync(path))return;const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('清理目录中包含符号链接');if(stat.isDirectory())for(const name of readdirSync(path))assertTree(join(path,name));}
function removeTree(root,path){assertOwnedPath(root,path);assertTree(path);rmSync(path,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
async function move(from,to){for(let i=0;;i++){try{renameSync(from,to);return;}catch(error){if(i>=20||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,100));}}}
function synchronize(from,to){
  assertTree(from);assertTree(to);
  function prepare(source,target){
    const directory=lstatSync(source).isDirectory();
    if(existsSync(target)&&lstatSync(target).isDirectory()!==directory)removeTree(to,target);
    if(directory){mkdirSync(target,{recursive:true});for(const name of readdirSync(source))prepare(join(source,name),join(target,name));}
  }
  prepare(from,to);cpSync(from,to,{recursive:true,force:true});
  function prune(source,target){for(const name of readdirSync(target)){
    const path=join(target,name),original=join(source,name);
    if(existsSync(original)){if(lstatSync(path).isDirectory())prune(original,path);continue;}
    if(lstatSync(path).isDirectory()){prune(original,path);try{rmdirSync(path);}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;}}
    else unlinkSync(path);
  }}prune(from,to);
}
export function atomicJson(path,value){
  mkdirSync(dirname(path),{recursive:true});const temp=join(dirname(path),'.agy-'+randomUUID()+'.tmp');
  try{writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch{}}
}
function readConfig(path){if(!existsSync(path))return{};const value=JSON.parse(readFileSync(path,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('客户端配置格式无效');return value;}
function changeConfig(paths,fn){assertOwnedPath(paths.root,paths.config);const config=readConfig(paths.config);fn(config);atomicJson(paths.config,config);}
async function withLock(paths,fn){
  assertOwnedPath(paths.home,paths.data);mkdirSync(paths.data,{recursive:true});const path=join(paths.data,'maintenance.lock'),nonce=randomUUID();let handle;
  try{handle=openSync(path,'wx');}catch(error){
    if(error.code!=='EEXIST')throw error;
    const lock=JSON.parse(readFileSync(path,'utf8'));let alive=true;try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw Error('已有安装或更新正在进行');unlinkSync(path);handle=openSync(path,'wx');
  }
  writeFileSync(handle,JSON.stringify({pid:process.pid,nonce}));closeSync(handle);
  try{return await fn();}finally{try{if(JSON.parse(readFileSync(path,'utf8')).nonce===nonce)unlinkSync(path);}catch{}}
}
function previousPlugin(paths){const config=readConfig(paths.config);return config.plugins?.['agy-powertools'];}
function setPlugin(paths,value){changeConfig(paths,config=>{config.plugins||={};if(value===undefined)delete config.plugins['agy-powertools'];else config.plugins['agy-powertools']=value;});}
function legacyBackups(source){
  const directory=join(source,'.backups');if(!existsSync(directory))return[];
  return readdirSync(directory).filter(name=>/^installed-\d{4}-[\dTZ.-]+$/.test(name)).flatMap(name=>{
    const path=join(directory,name);try{assertOwnedPath(source,path);const file=join(path,'plugin.json'),bytes=readFileSync(file);return JSON.parse(bytes).name==='agy-powertools'?[{name,pluginHash:sha256(bytes)}]:[];}catch{return[];}
  });
}

export async function installPlugin({source,bundle,home=homedir(),stop=stopRuntimes,verify,retainBackup=true}={}){
  const paths=installationPaths(home),payload=bundle?validatePackage(bundle):collectPackage(resolve(source));
  assertOwnedPath(paths.home,paths.installed);assertOwnedPath(paths.home,paths.data);
  return withLock(paths,async()=>{
    const previous=previousPlugin(paths),id=randomUUID(),stage=join(paths.data,'staging',id),backup=join(paths.data,'backups',id,'plugin');
    let moved=false,promoted=false,inPlace=false,receipt;
    try{
      if(existsSync(paths.installed)&&JSON.parse(readFileSync(join(paths.installed,'plugin.json'),'utf8')).name!=='agy-powertools')throw Error('安装位置包含其他项目');
      assertOwnedPath(paths.root,stage);receipt=writePackage(payload,stage);
      const previousReceipt=existsSync(join(paths.installed,'.agy-install.json'))?JSON.parse(readFileSync(join(paths.installed,'.agy-install.json'),'utf8')):{};
      receipt.sourceRoot=source?resolve(source):previousReceipt.sourceRoot;
      receipt.legacyBackups=source?legacyBackups(resolve(source)):previousReceipt.legacyBackups||[];
      atomicJson(join(stage,'.agy-install.json'),receipt);
      setPlugin(paths,{...previous,enabled:false});await stop(join(paths.data,'runtime'));
      if(existsSync(paths.installed)){
        assertTree(paths.installed);mkdirSync(dirname(backup),{recursive:true});
        try{await move(paths.installed,backup);}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;cpSync(paths.installed,backup,{recursive:true});inPlace=true;}moved=true;
      }
      mkdirSync(dirname(paths.installed),{recursive:true});
      if(inPlace)synchronize(stage,paths.installed);else await move(stage,paths.installed);promoted=true;
      for(const file of receipt.files)if(sha256(readFileSync(join(paths.installed,file.path)))!==file.sha256)throw Error('安装后校验失败');
      setPlugin(paths,{...previous,enabled:true});
      if(verify)await verify({paths,version:payload.version});
      let launcherResult=null;
      try{launcherResult=configureLaunchers({home:paths.home,dataDir:paths.data});}catch{}
      if(!retainBackup&&moved)removeTree(paths.data,dirname(backup));
      return{version:payload.version,destination:paths.installed,backup:moved&&retainBackup?backup:null,restartRequired:!verify,replacement:inPlace?'in-place':'directory',...(process.platform==='darwin'?{macLauncherApp:launcherResult?.macApp||null,macLauncherIconConfigured:Boolean(launcherResult?.iconConfigured)}:{})};
    }catch(error){
      setPlugin(paths,{...previous,enabled:false});await stop(join(paths.data,'runtime')).catch(()=>{});
      if(inPlace&&moved)synchronize(backup,paths.installed);
      else{if(promoted)removeTree(paths.root,paths.installed);if(moved){mkdirSync(dirname(paths.installed),{recursive:true});await move(backup,paths.installed);}}
      setPlugin(paths,previous);error.rolledBack=true;throw error;
    }finally{if(existsSync(stage))removeTree(paths.root,stage);}
  });
}

function ownTelemetry(path){
  try{return readFileSync(path,'utf8').split('\n').filter(Boolean).every(line=>{
    const value=JSON.parse(line);return value.pluginId==='agy-powertools'||['PreInvocation','PostInvocation'].includes(value.event)&&Number.isFinite(value.ts)&&typeof value.iso==='string'&&'invocationNum'in value&&'initialNumSteps'in value&&Object.keys(value).every(key=>['event','ts','iso','conversationId','invocationNum','initialNumSteps','modelName'].includes(key));
  });}catch{return false;}
}
function cleanBrain(paths){
  const retained=[];if(!existsSync(paths.brain))return retained;
  for(const id of readdirSync(paths.brain)){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))continue;
    for(const name of ['telemetry.jsonl','powertools-telemetry.jsonl']){
      const path=join(paths.brain,id,'.system_generated','logs',name);try{assertOwnedPath(paths.root,path);}catch{retained.push(path);continue;}
      if(existsSync(path)){if(ownTelemetry(path))unlinkSync(path);else retained.push(path);}
    }
  }
  return retained;
}

export async function uninstallPlugin({home=homedir(),purge=true,stop=stopRuntimes}={}){
  const paths=installationPaths(home);assertOwnedPath(paths.home,paths.installed);assertOwnedPath(paths.home,paths.data);
  const result=await withLock(paths,async()=>{
    if(existsSync(paths.installed)&&JSON.parse(readFileSync(join(paths.installed,'plugin.json'),'utf8')).name!=='agy-powertools')throw Error('安装位置包含其他项目');
    const receipt=existsSync(join(paths.installed,'.agy-install.json'))?JSON.parse(readFileSync(join(paths.installed,'.agy-install.json'),'utf8')):{};
    setPlugin(paths,{...previousPlugin(paths),enabled:false});await stop(join(paths.data,'runtime'),{purge});
    removeTree(paths.root,paths.installed);
    changeConfig(paths,config=>{delete config.plugins?.['agy-powertools'];for(const key of Object.keys(config.sidecars||{}))if(key==='agy-powertools'||key.startsWith('agy-powertools/'))delete config.sidecars[key];});
    const hooks=join(paths.root,'config','hooks.json');assertOwnedPath(paths.root,hooks);
    if(existsSync(hooks)){const config=readConfig(hooks);for(const key of Object.keys(config))if(key==='agy-powertools-telemetry'||key.startsWith('agy-powertools/'))delete config[key];atomicJson(hooks,config);}
    const retained=purge?cleanBrain(paths):[];
    if(purge){
      removeTree(paths.root,paths.sidecars);
      if(receipt.sourceRoot)for(const backup of receipt.legacyBackups||[]){
        const path=join(receipt.sourceRoot,'.backups',backup.name);if(!/^installed-\d{4}-[\dTZ.-]+$/.test(backup.name))continue;
        try{assertOwnedPath(join(receipt.sourceRoot,'.backups'),path);if(sha256(readFileSync(join(path,'plugin.json')))===backup.pluginHash)removeTree(join(receipt.sourceRoot,'.backups'),path);}catch{if(existsSync(path))retained.push(path);}
      }
    }
    return{removed:true,purged:purge,retained};
  });
  try{restoreLaunchers({home:paths.home,dataDir:paths.data});}catch{}
  if(purge)removeTree(paths.root,paths.data);
  return result;
}
