import type {Manager} from '../../../lib/manager.mjs';
import type {NativeAutomations} from '../../../lib/native-automations.mjs';
import type {Response} from '../types';
import {body,json} from '../protocol';
import {createDesktopService} from '../services/desktop';

export const matchDesktopRoute=(path:string)=>path.match(/^\/api\/desktop\/threads\/([0-9a-f-]{36})(?:\/(history|message|interrupt|acknowledge|recover|question-answer|settings|queue-steer|queue-delete|queue-update))?$/i);
type Match=ReturnType<typeof matchDesktopRoute>;
type Route=(url:URL,data:Awaited<ReturnType<typeof body>>,res:Response)=>Promise<void>;
export function createDesktopRoutes(manager:Manager,automations:NativeAutomations,sessionFor:(id:string)=>NativeAutomations,observe?:(id:string,turns:any[])=>void) {
 const service=createDesktopService(manager,automations,sessionFor);
 const reads=new Map<string,Route>([
  ['/api/desktop/candidates',async(url,_data,res)=>json(res,200,await service.candidates(url.searchParams.get('search')||'',url.searchParams.get('cursor')))],
  ['/api/automations',async(_url,_data,res)=>json(res,200,await service.list())],
  ['/api/automations/candidates',async(url,_data,res)=>json(res,200,await service.automationCandidates(url.searchParams.get('search')||''))],
  ['/api/automations/history',async(url,_data,res)=>json(res,200,await service.history(url.searchParams.get('cursor'),url.searchParams.get('threadId')))],
  ['/api/automations/session',async(_url,_data,res)=>json(res,200,await service.detail())],
 ]);
 const writes=new Map<string,Route>(Object.entries(service.actions).map(([action,call])=>[
  '/api/automations/'+action,async(_url,data,res)=>json(res,200,await call(data)),
 ]));
 return {
  read(path:string,match:Match):Route|undefined {
   if(match){
    // Resolving even unsupported actions preserves the baseline's UUID validation.
    const session=service.session(match[1]);
    if(!match[2])return async(_url,_data,res)=>{const detail=await session.detail();observe?.(match[1],detail.turns||[]);json(res,200,detail);};
    if(match[2]==='history')return async(url,_data,res)=>json(res,200,await session.history(url.searchParams.get('cursor')));
   }
   return reads.get(path);
  },
  desktopWrite(match:Match):Route|undefined {
   if(!match)return;
   const session=service.session(match[1]);
   const action=match[2];
   if(action==='queue-steer'||action==='queue-delete'||action==='queue-update')return async(_url,data,res)=>json(res,200,await session.queue(action.slice(6),data));
   if(action==='message'||action==='interrupt'||action==='acknowledge'||action==='recover'||action==='question-answer'||action==='settings')return async(_url,data,res)=>json(res,200,await session[action](data));
  },
  automationWrite:(path:string)=>writes.get(path),
 };
}
