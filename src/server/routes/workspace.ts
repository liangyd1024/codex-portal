import type {Manager} from '../../../lib/manager.mjs';
import type {Response} from '../types';
import {body,json} from '../protocol';
import {createWorkspaceService} from '../services/workspace';

type Route=(url:URL,data:Awaited<ReturnType<typeof body>>,res:Response)=>Promise<void>;
export function createWorkspaceRoutes(manager:Manager) {
 const service=createWorkspaceService(manager);
 return new Map<string,Route>([
  ['GET /api/file-suggestions',async(url,_data,res)=>json(res,200,await service.files(url.searchParams.get('cwd'),url.searchParams.get('query')||''))],
  ['GET /api/composer',async(url,_data,res)=>json(res,200,await service.composer(url.searchParams.get('cwd'),url.searchParams.get('kind')))],
  ['GET /api/sidebar/activity',async(url,_data,res)=>json(res,200,await service.activity(Object.fromEntries(url.searchParams)))],
  ['GET /api/sidebar',async(url,_data,res)=>json(res,200,await service.sidebar(Object.fromEntries(url.searchParams)))],
  ['GET /api/project-folders',async(url,_data,res)=>json(res,200,await service.browse(url.searchParams.get('path')))],
  ['POST /api/project-folders',async(_url,data,res)=>json(res,200,await service.createFolder(data))],
  ['POST /api/projects/open',async(_url,data,res)=>json(res,200,await service.openProject(data))],
  ['POST /api/sidebar/actions',async(_url,data,res)=>json(res,200,await service.sidebarAction(data))],
 ]);
}
