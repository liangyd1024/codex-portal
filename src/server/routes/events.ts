import type {IncomingMessage} from 'node:http';
import type {Manager} from '../../../lib/manager.mjs';
import type {MobileAccess} from '../services/mobile-access';
import type {WebUpdate} from '../services/web-update';
import type {Response} from '../types';
import {AppError} from '../../../lib/manager.mjs';
import {body,json} from '../protocol';

interface EventServices {clients:Set<Response>;access:MobileAccess;updater:WebUpdate}
export function createEventRoute({clients,access,updater}:EventServices) {
 return (req:IncomingMessage,res:Response,manager:Manager,targetKey:string,remote:boolean,url:URL)=>{
  const viewId=url.searchParams.get('viewId');
  if(viewId&&!/^[a-zA-Z0-9_-]{16,80}$/.test(viewId))throw new AppError('页面标识无效。');
  res.viewId=viewId;
  const releaseView=manager.retention?.attach(viewId||res);
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write(`data: ${JSON.stringify({method:'manager/status',params:manager.status()})}\n\n`);res.targetKey=targetKey;clients.add(res);
  for(const request of manager.status().pendingRequests||[])res.write(`data: ${JSON.stringify({method:'manager/request',params:request})}\n\n`);
  const heartbeat=setInterval(()=>{if(remote&&!access.valid(req)){res.end();clients.delete(res);}else res.write(': ping\n\n');},15000);
  res.mobileRequest=remote?req:null;
  const sendUpdate=(data:unknown)=>{if(res.destroyed||res.writableEnded)return;if(res.writableLength>8*1024*1024){res.destroy();return;}res.write(`event: system/update\ndata: ${JSON.stringify(data)}\n\n`);};
  const unsubscribe=updater.subscribe?.(sendUpdate);
  void updater.status().then(sendUpdate).catch(()=>{});
  res.once('close',()=>{clearInterval(heartbeat);unsubscribe?.();releaseView?.();clients.delete(res);});return;
 };
}

export function createThreadViewRoute({clients,access}:EventServices) {
 return async(req:IncomingMessage,res:Response,manager:Manager,targetKey:string,remote:boolean,data:Awaited<ReturnType<typeof body>>)=>{
  if(typeof data.viewId!=='string'||!Number.isSafeInteger(data.revision)||data.revision<0||
    (data.threadId!==null&&(typeof data.threadId!=='string'||!/^[0-9a-f-]{36}$/i.test(data.threadId)))||
    (data.sideThreadId!=null&&(typeof data.sideThreadId!=='string'||!/^[0-9a-f-]{36}$/i.test(data.sideThreadId))))throw new AppError('会话页面参数无效。');
  const client=[...clients].find(c=>c.targetKey===targetKey&&c.viewId===data.viewId&&Boolean(c.mobileRequest)===remote&&(!remote||access.token(c.mobileRequest!)===access.token(req)));
  if(!client||!manager.retention)throw new AppError('页面连接已变化，请重试。',409,'VIEW_DISCONNECTED');
  await manager.retention.view(data.viewId,data.threadId,data.revision,data.sideThreadId??null);
  return json(res,200,{ok:true});
 };
}
