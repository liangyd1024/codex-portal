import type {IncomingMessage} from 'node:http';
import type {Manager} from '../../../lib/manager.mjs';
import type {MobileAccess} from '../../../lib/mobile-access.mjs';
import type {WebUpdate} from '../../../lib/web-update.mjs';
import type {Response} from '../types';

interface EventServices {clients:Set<Response>;access:MobileAccess;updater:WebUpdate}
export function createEventRoute({clients,access,updater}:EventServices) {
 return (req:IncomingMessage,res:Response,manager:Manager,targetKey:string,remote:boolean)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write(`data: ${JSON.stringify({method:'manager/status',params:manager.status()})}\n\n`);res.targetKey=targetKey;clients.add(res);
  for(const request of manager.status().pendingRequests||[])res.write(`data: ${JSON.stringify({method:'manager/request',params:request})}\n\n`);
  const heartbeat=setInterval(()=>{if(remote&&!access.valid(req)){res.end();clients.delete(res);}else res.write(': ping\n\n');},15000);
  res.mobileRequest=remote?req:null;
  const sendUpdate=(data:unknown)=>{if(res.destroyed||res.writableEnded)return;if(res.writableLength>8*1024*1024){res.destroy();return;}res.write(`event: system/update\ndata: ${JSON.stringify(data)}\n\n`);};
  const unsubscribe=updater.subscribe?.(sendUpdate);
  void updater.status().then(sendUpdate).catch(()=>{});
  res.once('close',()=>{clearInterval(heartbeat);unsubscribe?.();clients.delete(res);});return;
 };
}
