import {ConnectionConfigStore} from '../../lib/connection-config.mjs';
import {WorkspaceManager} from './services/workspace-manager';
import {createDispatcher} from './routes/dispatch';
import type {ServerOptions} from 'node:https';
import type {Response,MobileConfig,Host,Config} from './types';
import type {ApplicationOptions} from './types';
import {createStaticResponse} from '../../lib/http/static-response.mjs';
import {WebUpdate} from './services/web-update';
import {supportDir} from '../../lib/config.mjs';
import {homedir} from 'node:os';
import http from 'node:http';
import {json} from './protocol';
import https from 'node:https';
import {MobileAccess} from './services/mobile-access';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createLocalTransport} from '../../lib/local.mjs';
import {createSshTransport} from '../../lib/ssh.mjs';
import {loadConfig,publicHost} from '../../lib/config.mjs';
import {Manager,AppError} from '../../lib/manager.mjs';
import {NativeAutomations} from '../../lib/native-automations.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let BUILD_VERSION='development';try{BUILD_VERSION=(await readFile(path.join(ROOT,'VERSION'),'utf8')).trim();}catch{}
export function createApp({connectionConfigFile,serverFactory=handler=>http.createServer(handler),proxyFactory=handler=>http.createServer(handler),secureFactory=(options,handler)=>https.createServer(options,handler),staticRoot=path.join(ROOT,'public'),extraAssets={},buildVersion=BUILD_VERSION,mobileConfig=null,setupMobile=null,access=new MobileAccess(null),config=loadConfig(),stateDir=process.env.RCM_STATE_DIR||path.join(homedir(),'.codex/remote-codex-manager'),managers:providedManagers,updater=new WebUpdate({supportDir,root:ROOT,version:BUILD_VERSION})}: ApplicationOptions={}) {
 const enableAccountRecovery=buildVersion!=='development'&&stateDir===path.join(homedir(),'.codex/remote-codex-manager')&&Number(process.env.RCM_PORT||4317)===4317;
 const managers=providedManagers||new Map(config.connections.map((host:Host)=>[host.id,new WorkspaceManager({enableAccountRecovery,titleStore:path.join(stateDir,`web-titles-${host.id}.json`),host:publicHost(host),...(host.kind==='local'?createLocalTransport(host):createSshTransport(host))})]));
 const manager=managers.get(config.defaultConnection);
 const automations=new Map([...managers].map(([id,m])=>[id,new NativeAutomations(m)]));
 const desktopSessions=new Map<string,NativeAutomations>();
 const desktopSession=(host:string,id:string)=>{
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new AppError('会话 ID 无效。');
   if(automations.get(host)!.state.threadId===id)return automations.get(host)!;
   const key=host+':'+id;
   if(!desktopSessions.has(key))desktopSessions.set(key,new NativeAutomations(managers.get(host),{threadId:id}));
   return desktopSessions.get(key)!;
 };
  const broadcasts=new Map<string,(event:unknown)=>void>();
  const staticResponse=createStaticResponse();
  const csrf=randomBytes(32).toString('hex'); const clients=new Set<Response>();

  for(const [key,target] of managers){const listener=(event:unknown)=>{for(const client of clients){if(client.targetKey!==key)continue;if(client.writableLength>8*1024*1024){client.destroy();clients.delete(client);}else client.write(`data: ${JSON.stringify(event)}\n\n`);}};broadcasts.set(key,listener);target.on('event',listener);}
  const connectionWrites=new Map<string,number>();
 const registry=connectionConfigFile?new ConnectionConfigStore(connectionConfigFile):null;
 const changeConnections=registry?async(data:Record<string,unknown>)=>registry.change(data,(next:Config,change:{action:string;id:string})=>{
  const previous=config.connections.find(host=>host.id===change.id),host=next.connections.find(host=>host.id===change.id);
  const old=managers.get(change.id);
  const replace=!!old&&!!host&&previous&&(host.binary!==previous.binary||host.identityFile!==previous.identityFile);
  if(old&&(replace||!host)){
   const status=old.status();
   if(connectionWrites.get(change.id)||['connecting','reconnecting'].includes(status.connection.state)||status.pendingRequests.length)throw new AppError('连接正在恢复或有请求尚未确认，请处理后再修改。',409);
  }
  const added=host&&(!old||replace)?new WorkspaceManager({enableAccountRecovery,titleStore:path.join(stateDir,`web-titles-${host.id}.json`),host:publicHost(host),...(host.kind==='local'?createLocalTransport(host):createSshTransport(host))}):null;
  return ()=>{
   if(old&&(replace||!host)){
    old.off('event',broadcasts.get(change.id)!);old.disconnect({preserveIntent:true});
    managers.delete(change.id);automations.delete(change.id);broadcasts.delete(change.id);
    for(const key of desktopSessions.keys())if(key.startsWith(change.id+':'))desktopSessions.delete(key);
   }
   if(added){
    managers.set(change.id,added);automations.set(change.id,new NativeAutomations(added));
    const listener=(event:unknown)=>{for(const client of clients)if(client.targetKey===change.id){if(client.writableLength>8*1024*1024)client.destroy();else client.write(`data: ${JSON.stringify(event)}\n\n`);}};
    broadcasts.set(change.id,listener);added.on('event',listener);
   }else if(old&&host){Object.assign(old.host,{alias:host.alias});if(old.expectedHost)Object.assign(old.expectedHost,{alias:host.alias});}
   Object.assign(config,next);
   for(const client of clients)client.write(`event: configuration/change\ndata: ${JSON.stringify({version:registry.revision})}\n\n`);
  };
 }):null;
 const handler=createDispatcher({connectionWrites,registry,changeConnections,config,managers,automations,desktopSessions,desktopSession,csrf,clients,staticResponse,access,setupMobile,updater,providedManagers,buildVersion,staticRoot,extraAssets,server:()=>server,mobileConfig:()=>mobileConfig,setMobileConfig:value=>{mobileConfig=value;}});
  const server=serverFactory((req,res)=>handler(req,res));
  const proxyServer=proxyFactory((req,res)=>handler(req,res,true));
  const createSecureServer=(options:ServerOptions)=>secureFactory(options,(req,res)=>handler(req,res,true));
  server.on('listening',()=>{for(const m of managers.values())Promise.resolve(m.restoreConnection?.()).catch(()=>{});});
  server.on('close',()=>{for(const [key,m] of managers){m.off('event',broadcasts.get(key)!);m.disconnect({preserveIntent:true});}for(const client of clients)client.end();});
  return {server,manager,managers,proxyServer,createSecureServer,closeStreams(){for(const client of clients)client.end();},setMobileConfig:(value:MobileConfig)=>{mobileConfig=value;}};
}

