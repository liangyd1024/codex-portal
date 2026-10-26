import {readFileSync} from 'node:fs';
import {open,writeFile,rename,unlink,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {saveCredential,deleteCredential} from './ssh-credentials.mjs';
import {validateConfig,publicHost} from './config.mjs';
const revision=text=>createHash('sha256').update(text).digest('hex');
const failure=(message,code='CONFIG_CONFLICT')=>Object.assign(Error(message),{status:409,code});
const identity=['kind','machineId','user','home','address','port'];
const editable=['alias','binary','identityFile'];
export class ConnectionConfigStore {
 constructor(file,{save=saveCredential,remove=deleteCredential}={}){this.credentials={save,remove};this.file=file;const text=readFileSync(file,'utf8');this.config=validateConfig(JSON.parse(text));this.revision=revision(text);this.writing=false;}
 snapshot(){return {revision:this.revision,defaultConnection:this.config.defaultConnection,connections:this.config.connections.map(host=>({...publicHost(host),hasIdentityFile:!!host.identityFile}))};}
 /** @param {any} data @param {(next:any,change:{action:string,id:string})=>(()=>void)} prepare */
 async change(data,prepare=(_next,_change)=>()=>{}){
  if(this.writing)throw failure('连接配置正在保存，请稍后重试。');this.writing=true;
  let lock,temporary,newCredential,published=false,oldCredential;
  try{
   try{lock=await open(this.file+'.lock','wx',0o600);}catch(error){if(error.code==='EEXIST')throw failure('其他入口正在修改配置，请稍后重新读取。');throw error;}
   const raw=await readFile(this.file,'utf8');
   if(revision(raw)!==this.revision)throw failure('配置文件已在外部修改，请重启网页后再保存。','CONFIG_EXTERNAL_CHANGE');
   if(data.revision!==this.revision)throw failure('连接配置已变化，请重新读取后再保存。');
   const next=structuredClone(this.config);
   let changedId;
   if(data.action==='add'){
    const value=data.connection;
    if(!value||value.kind!=='ssh')throw failure('只能新增 SSH 连接。','INVALID_CONFIG');
    const id='ssh-'+randomUUID();changedId=id;
    next.connections.push({id,machineId:'machine-'+randomUUID(),kind:'ssh',alias:value.alias,address:value.address,port:value.port,user:value.user,home:value.home,binary:value.binary,identityFile:value.identityFile,...value.python?{python:value.python}:{}});
   }else{
    const current=next.connections.find(host=>host.id===data.id);
    if(!current)throw failure('连接不存在，请重新读取。');changedId=current.id;
    if(data.action==='rename'||data.action==='edit'){
     const patch=data.connection||{};
     if(identity.some(key=>patch[key]!==undefined&&patch[key]!==current[key]))throw failure('目标身份不能覆盖为另一台机器，请新增连接以保留原数据。','IDENTITY_CHANGE');
     if(patch.identityFile&&!patch.password)delete current.credentialRef;
     for(const key of editable)if(patch[key]!==undefined&&(key!=='identityFile'||patch[key]!==''))current[key]=patch[key];
    }else if(data.action==='default')next.defaultConnection=current.id;
    else if(data.action==='remove'){
     if(current.kind==='local')throw failure('不能移除本机连接。','INVALID_CONFIG');
     next.connections=next.connections.filter(host=>host.id!==current.id);
     if(next.defaultConnection===current.id)next.defaultConnection=next.connections.find(host=>host.kind==='local').id;
    }else throw failure('未知连接操作。','INVALID_CONFIG');
   }
   const changed=next.connections.find(host=>host.id===changedId);
   oldCredential=this.config.connections.find(host=>host.id===changedId)?.credentialRef;
   const password=data.connection?.password;
   if(password&&['add','edit'].includes(data.action)){
    if(changed?.kind!=='ssh')throw failure('仅 SSH 连接支持密码。','INVALID_CONFIG');
    newCredential=await this.credentials.save(password,data.connection.rememberPassword!==false);changed.credentialRef=newCredential;
   }
   validateConfig(next);
   for(const host of next.connections)if(typeof host.alias!=='string'||!host.alias.trim()||host.alias.length>80)throw failure('连接名称必须为 1 至 80 个字符。','INVALID_CONFIG');
   const apply=prepare(next,{action:data.action,id:changedId});
   const text=JSON.stringify(next,null,2)+'\n';temporary=this.file+'.'+randomUUID()+'.tmp';
   await writeFile(temporary,text,{flag:'wx',mode:0o600});
   await rename(temporary,this.file);temporary=null;
   this.config=next;this.revision=revision(text);published=true;apply();
   if(oldCredential&&oldCredential!==changed?.credentialRef)await this.credentials.remove(oldCredential).catch(()=>console.error('旧 SSH 凭据清理失败，请检查钥匙串。'));
   return this.snapshot();
  }finally{
   if(newCredential&&!published)await this.credentials.remove(newCredential).catch(()=>console.error('未使用的 SSH 凭据清理失败，请检查钥匙串。'));
   if(temporary)await unlink(temporary);
   if(lock){await lock.close();await unlink(this.file+'.lock');}
   this.writing=false;
  }
 }
}

export async function probeConnection(config,data,{remote,local}={}){
 const existing=config.connections.find(host=>host.id===data.id);
 const candidate=existing?{...existing,...Object.fromEntries(editable.filter(key=>data.connection?.[key]).map(key=>[key,data.connection[key]]))}:{...data.connection,id:'probe',machineId:'probe-machine',kind:'ssh'};
 const localHost=config.connections.find(host=>host.kind==='local');
 validateConfig({...config,defaultConnection:localHost.id,connections:candidate.kind==='local'?[candidate]:[localHost,candidate]});
 if(candidate.kind==='ssh'){
  if(data.connection?.identityFile&&!data.connection?.password)delete candidate.credentialRef;
  if(data.connection?.password)candidate.password=data.connection.password;
  const invoke=remote||(await import('./ssh.mjs')).remotePython;
  await invoke(candidate,"import os,pwd,json\nif pwd.getpwuid(os.getuid()).pw_name!=SERVICE_USER or os.path.expanduser('~')!=SERVICE_HOME: raise RuntimeError('目标身份不符')\nif not os.path.isfile(SERVICE_BINARY) or not os.access(SERVICE_BINARY,os.X_OK): raise RuntimeError('Codex 路径不可执行')\nprint('RCM_JSON:'+json.dumps({'ok':True}))",{timeoutMs:8000});
 }else{
  const invoke=local||(await import('./ssh.mjs')).execute;await invoke(candidate.binary,['--version'],{timeoutMs:5000,maxBytes:65536});
 }
 return {ok:true,message:'身份与可执行路径检查通过。'};
}
