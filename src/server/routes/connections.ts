import type {Manager} from '../../../lib/manager.mjs';
import type {Response} from '../types';
import {body,json} from '../protocol';
import {createConnectionService} from '../services/connections';

// Payloads have already passed the original protocol reader. Do not coerce,
// default, strip, or validate them again in a framework schema.
type Payload=Awaited<ReturnType<typeof body>>;
type Route=(url:URL,data:Payload,res:Response)=>void|Promise<void>;
export function createConnectionRoutes(manager:Manager) {
 const service=createConnectionService(manager);
 return new Map<string,Route>([
  ['GET /api/status',(_url,_data,res)=>json(res,200,service.status())],
  ['GET /api/account/usage',async(_url,_data,res)=>json(res,200,await service.accountUsage())],
  ['GET /api/models',async(url,_data,res)=>json(res,200,await service.models(url.searchParams.get('refresh')==='1'))],
  ['GET /api/projects',async(_url,_data,res)=>json(res,200,await service.projects())],
  ['POST /api/connect',(_url,_data,res)=>json(res,202,service.connect())],
  ['POST /api/disconnect',(_url,_data,res)=>json(res,200,service.disconnect())],
  ['POST /api/notices/ack',(_url,data,res)=>json(res,200,service.acknowledgeNotice(data.key))],
  ['POST /api/diagnostics/clear',(_url,_data,res)=>json(res,200,service.clearDiagnostics())],
  ['POST /api/account/reload',async(_url,data,res)=>json(res,200,await service.reloadLogin(data))],
  ['POST /api/service/release',async(_url,data,res)=>json(res,200,await service.release(data))],
 ]);
}
