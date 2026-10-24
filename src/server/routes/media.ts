import type {IncomingMessage} from 'node:http';
import type {Response} from '../types';
import {AppError,type Manager} from '../../../lib/manager.mjs';
import {fileResponse} from '../../../lib/file-response.mjs';
import {createMediaService} from '../services/media';

type Route=(req:IncomingMessage,res:Response,url:URL)=>Promise<void>;
export function createMediaRoutes(manager:Manager) {
 const service=createMediaService(manager);
 return {
  read(method:string|undefined,path:string):Route|undefined {
   const file=path.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/file$/);
   if((method==='GET'||method==='HEAD')&&file)return async(req,res,url)=>{
    await fileResponse(service,req,res,file[1],file[2],url);
   };
   const image=path.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/image$/);
   if(method!=='GET'||!image)return;
   return async(_req,res,url)=>{
    const result=await service.image(image[1],image[2],{preview:url.searchParams.get('preview')==='1',part:url.searchParams.get('part'),reference:url.searchParams.get('reference')});
    const content=Buffer.from(result.data,'base64');
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(result.mime))throw new AppError('不支持此图片格式。');
    res.writeHead(200,{'Content-Type':result.mime,'Content-Length':content.length,'Cache-Control':'private, max-age=300',...(url.searchParams.get('download')==='1'?{'Content-Disposition':`attachment; filename="${image[2]}.${result.extension}"`}:{})});res.end(content);
   };
  },
 };
}
