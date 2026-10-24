import type {Manager} from '../../../lib/manager.mjs';
import {AppError} from '../../../lib/manager.mjs';
import type {Response} from '../types';
import {json,body} from '../protocol';
import {createSystemService,type SystemServices} from '../services/system';

type ReadRoute=(url:URL,res:Response)=>void|Promise<void>;
export function createSystemRoutes(context:SystemServices) {
 const service=createSystemService(context);
 const reads=new Map<string,ReadRoute>([
  ['/api/connections',(_url,res)=>json(res,200,service.connections())],
  ['/api/system/update',async(url,res)=>json(res,200,await service.updateStatus(url.searchParams.get('check')==='1'))],
  ['/api/version',(_url,res)=>json(res,200,service.version())],
 ]);
 return {
  read:(path:string)=>reads.get(path),
  async deployment(manager:Manager,remote:boolean,res:Response){if(remote)throw new AppError('仅限本机部署检查。',403);json(res,200,await service.deployment(manager));},
  async update(data:Awaited<ReturnType<typeof body>>,port:number|undefined,res:Response){json(res,202,await service.startUpdate(data,port));},
 };
}
