import type {IncomingMessage} from 'node:http';
import type {Manager} from '../../../lib/manager.mjs';
import type {Response} from '../types';
import {body,json} from '../protocol';
import {createThreadService} from '../services/threads';

export const matchThreadRoute=(path:string)=>path.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})(?:\/(notification-target|side-chat|side-chat-view|turn-directory|history|takeover|handoff|message|steer|queue-add|queue-steer|queue-delete|queue-update|interrupt|goal|question-answer|retry-capacity))?$/);
type Match=ReturnType<typeof matchThreadRoute>;
type Route=(req:IncomingMessage,res:Response,url:URL,data:Awaited<ReturnType<typeof body>>)=>void|Promise<void>;
export function createThreadRoutes(manager:Manager,observe?:(id:string,turns:any[])=>void) {
 const service=createThreadService(manager);
 const list:Route=async(_req,res,url)=>json(res,200,await service.list(Object.fromEntries(url.searchParams)));
 const references:Route=async(_req,res,url)=>json(res,200,await service.list({search:url.searchParams.get('search')||'',cursor:url.searchParams.get('cursor')}));
 const create:Route=async(_req,res,_url,data)=>json(res,201,await service.create(data));
 return {
  read(path:string,match:Match):Route|undefined {
   if(path==='/api/threads')return list;
   if(path==='/api/thread-references')return references;
   if(!match)return;
   const [,id,action]=match;
   if(action==='notification-target')return async(_req,res)=>json(res,200,await service.notificationTarget(id));
   if(action==='side-chat-view')return async(_req,res)=>json(res,200,await service.sideChat(id));
   if(action==='turn-directory')return async(_req,res)=>json(res,200,await service.turnDirectory(id));
   if(action==='history')return async(_req,res,url)=>json(res,200,await service.history(id,url.searchParams.get('cursor'),false,{},false,null,url.searchParams.get('lazyTools')==='1'));
   if(!action)return async(req,res,url)=>{const detail=await service.detail(id,JSON.parse(String(req.headers['x-output-versions']||'{}')),url.searchParams.get('preview')==='1',url.searchParams.get('outputEncoding'),url.searchParams.get('fast')==='1',url.searchParams.get('lazyTools')==='1');observe?.(id,detail.turns||[]);json(res,200,detail);};
  },
  write(path:string,match:Match):Route|undefined {
   if(path==='/api/threads')return create;
   if(!match||!Object.hasOwn(service.actions,match[2]))return;
   const action=service.actions[match[2] as keyof typeof service.actions];
   return async(_req,res,_url,data)=>json(res,200,await action(match[1],data));
  },
 };
}
