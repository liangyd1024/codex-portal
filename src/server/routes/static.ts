import type {IncomingMessage} from 'node:http';
import type {Response} from '../types';
import type {RouteServices} from './dispatch';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../../lib/manager.mjs';

import {publicAssets as assets,generatedAsset} from '../../../lib/public-assets.mjs';

const loginAssets=['/','/index.html','/login.js','/styles.css','/mobile-ui.css'];

export function createStaticRoutes({staticRoot,extraAssets,staticResponse}:Pick<RouteServices,'staticRoot'|'extraAssets'|'staticResponse'>) {
 return {
  isLoginAsset:(pathname:string)=>loginAssets.includes(pathname),
  async login(pathname:string,res:Response){
   const file=pathname==='/login.js'?'login.js':pathname==='/styles.css'?'styles.css':pathname==='/mobile-ui.css'?'mobile-ui.css':'login.html';
   res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store'});
   res.end(await readFile(path.join(staticRoot,file)));
  },
  async read(req:IncomingMessage,res:Response,pathname:string){
   if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('不支持此请求方法。',405);
   if(pathname==='/mermaid-frame.html')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-scripts");
   // Only generated bundle paths extend the baseline's explicit public routes.
   // Copying a legacy file into the build must not republish a withdrawn route.
   const generated=generatedAsset(pathname);
   const file=assets[pathname]||(generated?extraAssets[pathname]:undefined);
   if(!file){res.writeHead(404);res.end('Not found');return;}
   await staticResponse(req,res,path.join(staticRoot,file));
  },
 };
}
