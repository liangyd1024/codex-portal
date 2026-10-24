import type {IncomingMessage} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {MobileConfig,Response} from '../types';
import {body,json} from '../protocol';
import {AppError} from '../../../lib/manager.mjs';
import {createAccessService,type AccessServices} from '../services/access';

type ReadRoute=(req:IncomingMessage,res:Response,url:URL)=>Promise<void>;
type WriteRoute=(req:IncomingMessage,res:Response,data:Awaited<ReturnType<typeof body>>)=>void|Promise<void>;
export function createAccessRoutes(context:AccessServices) {
 const service=createAccessService(context);
 return {
  async login(req:IncomingMessage,res:Response){const data=await body(req);res.setHeader('Set-Cookie',service.login(data.code));json(res,200,{ok:true});},
  read(pathname:string,remote:boolean,config:MobileConfig|null):ReadRoute|undefined {
   if(pathname==='/api/access/status')return async(req,res)=>json(res,200,await service.status(req,remote,config));
   if(remote||!config)return;
   if(pathname==='/api/access/ca')return async(_req,res)=>{res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="Codex-Local-CA.crt"'});res.end(await readFile(config.ca));};
   if(pathname==='/api/access/qr')return async(_req,res,url)=>{const name=url.searchParams.get('kind')==='tailscale'?'tailscale.png':'lan.png';res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(path.join(path.dirname(config.ca),name)));};
  },
  write(pathname:string,remote:boolean,config:MobileConfig|null):WriteRoute|undefined {
   if(pathname==='/api/access/setup'&&!remote)return async(_req,res,data)=>json(res,200,await service.setup(data));
   if(pathname==='/api/access/code'&&!remote)return (_req,res,data)=>{
    if(!config?.origins?.length)throw new AppError('请先配置手机访问地址，再生成配对码。',409,'MOBILE_NOT_CONFIGURED');
    json(res,200,service.code(data.ttlSeconds,data.sessionTtlSeconds));
   };
   if(pathname==='/api/access/revoke'&&!remote)return (_req,res)=>json(res,200,service.revoke());
   if(pathname==='/api/access/logout')return (req,res)=>{res.setHeader('Set-Cookie',service.logout(req));service.closeInvalidStreams();json(res,200,{ok:true});};
  },
 };
}
