import type {IncomingMessage} from 'node:http';
import type {MobileAccess} from '../../../lib/mobile-access.mjs';
import {AppError} from '../../../lib/manager.mjs';
import {tailscaleHealth} from '../../../lib/tailscale-serve.mjs';
import type {ApplicationOptions,MobileConfig,Response} from '../types';

export interface AccessServices {
 access:MobileAccess;clients:Set<Response>;setupMobile:ApplicationOptions['setupMobile'];
 setMobileConfig:(value:MobileConfig)=>void;
}
export function createAccessService({access,clients,setupMobile,setMobileConfig}:AccessServices) {
 return {
  login:(code:unknown)=>access.cookie(access.login(code)),
  async status(req:IncomingMessage,remote:boolean,config:MobileConfig|null) {
   return {local:!remote,sessionExpires:remote?access.expires(req):undefined,origins:remote?[]:config?.origins||[],canSetup:!remote&&Boolean(setupMobile),tailscaleStatus:!remote&&config?.origins.some(origin=>new URL(origin).hostname.endsWith('.ts.net'))?await tailscaleHealth():undefined};
  },
  async setup(data:{mode?:string}) {
   if(!setupMobile)throw new AppError('此入口不支持配置手机访问。请在本机正式服务中操作。',409);
   if(data.mode!==undefined&&!['lan','tailscale'].includes(data.mode))throw new AppError('未知手机访问方式。');
   const config=await setupMobile(data.mode||'lan');setMobileConfig(config);return {ok:true};
  },
  code:(...args:Parameters<MobileAccess['createCode']>)=>access.createCode(...args),
  revoke(){access.revoke();for(const client of clients)if(client.mobileRequest){client.end();clients.delete(client);}return {ok:true};},
  logout:(req:IncomingMessage)=>{access.logout(req);return access.cookie();},
  closeInvalidStreams(){for(const client of clients)if(client.mobileRequest&&!access.valid(client.mobileRequest)){client.end();clients.delete(client);}},
 };
}
