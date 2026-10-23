import type {IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {Response,MobileConfig,Host} from '../types';
import type {ApplicationOptions} from '../types';
import {createThreadRoutes,matchThreadRoute} from './threads';
import {createStaticResponse} from '../../../lib/http/static-response.mjs';
import {browseFolders,createFolder,openFolderProject} from '../../../lib/project-folders.mjs';
import {deploymentStatus} from '../../../lib/deployment-status.mjs';
import {WebUpdate} from '../../../lib/web-update.mjs';
import {createConnectionRoutes} from './connections';
import {fileResponse} from '../../../lib/file-response.mjs';
import {readSidebar,readSidebarActivity,sidebarAction} from '../../../lib/sidebar.mjs';
import {composerCatalog} from '../../../lib/composer.mjs';
import http from 'node:http';
import {json,body} from '../protocol';
import {MobileAccess} from '../../../lib/mobile-access.mjs';
import {tailscaleHealth} from '../../../lib/tailscale-serve.mjs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {publicHost} from '../../../lib/config.mjs';
import {Manager,AppError} from '../../../lib/manager.mjs';
import {NativeAutomations} from '../../../lib/native-automations.mjs';

export interface RouteServices {
 config:import('../types').Config; managers:Map<string,Manager>; automations:Map<string,NativeAutomations>;
 desktopSessions:Map<string,NativeAutomations>;desktopSession:(host:string,id:string)=>NativeAutomations;
 csrf:string;clients:Set<Response>;staticResponse:ReturnType<typeof createStaticResponse>;
 access:MobileAccess;setupMobile:ApplicationOptions['setupMobile'];updater:WebUpdate;
 providedManagers:ApplicationOptions['managers'];buildVersion:string;staticRoot:string;extraAssets:Record<string,string>;
 server:()=>import('node:http').Server;mobileConfig:()=>MobileConfig|null;setMobileConfig:(value:MobileConfig)=>void;
}
export function createDispatcher(context:RouteServices){
 const threadRoutes=new WeakMap<Manager,ReturnType<typeof createThreadRoutes>>();
 const threadRoutesFor=(manager:Manager)=>{let routes=threadRoutes.get(manager);if(!routes){routes=createThreadRoutes(manager);threadRoutes.set(manager,routes);}return routes;};
 const connectionRoutes=new WeakMap<Manager,ReturnType<typeof createConnectionRoutes>>();
 const routesFor=(manager:Manager)=>{let routes=connectionRoutes.get(manager);if(!routes){routes=createConnectionRoutes(manager);connectionRoutes.set(manager,routes);}return routes;};
 const {config,managers,automations,desktopSessions,desktopSession,csrf,clients,staticResponse,access,setupMobile,updater,providedManagers,buildVersion,staticRoot,extraAssets}=context;
  return async(req:IncomingMessage,res:Response,remote=false)=>{
    const server=context.server();let mobileConfig=context.mobileConfig();
    res.allowGzip=String(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;|\s*$)/i.test(part.trim())&&!/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(part));
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Host and origin checks protect the local control API against DNS rebinding and drive-by sites.
      const port=(server.address() as AddressInfo|null)?.port;
      const origin=remote ? mobileConfig?.origins.find(value=>new URL(value).host===req.headers.host) : [`http://127.0.0.1:${port}`,`http://localhost:${port}`].find(value=>new URL(value).host===req.headers.host);
      if(!origin)throw new AppError('访问地址未获授权。',403,'FORBIDDEN');
      if((req.headers.origin&&req.headers.origin!==origin)||(remote&&req.method==='POST'&&req.headers.origin!==origin))throw new AppError('不允许跨站访问。',403,'FORBIDDEN');
      const url=new URL(req.url!,origin);const p=url.pathname;
      if(p==='/api/access/login'&&remote&&req.method==='POST'){
        const data=await body(req);
        const token=access.login(data.code);res.setHeader('Set-Cookie',access.cookie(token));return json(res,200,{ok:true});
      }
      if(remote&&!access.valid(req)){
        if(req.method==='GET'&&['/','/index.html','/login.js','/styles.css','/mobile-ui.css'].includes(p)){
          const file=p==='/login.js'?'login.js':p==='/styles.css'?'styles.css':p==='/mobile-ui.css'?'mobile-ui.css':'login.html';
          res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(staticRoot,file)));
        }
        throw new AppError('请先使用本机生成的配对码登录。',401,'PAIRING_REQUIRED');
      }
      if(remote&&access.expires(req)===null)res.setHeader('Set-Cookie',access.cookie(access.token(req)));
      if(p==='/api/access/status'&&req.method==='GET')return json(res,200,{local:!remote,sessionExpires:remote?access.expires(req):undefined,origins:remote?[]:mobileConfig?.origins||[],canSetup:!remote&&Boolean(setupMobile),tailscaleStatus:!remote&&mobileConfig?.origins.some(origin=>new URL(origin).hostname.endsWith('.ts.net'))?await tailscaleHealth():undefined});
      if(p==='/api/access/ca'&&!remote&&req.method==='GET'&&mobileConfig){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="Codex-Local-CA.crt"'});return res.end(await readFile(mobileConfig.ca));}
      if(p==='/api/access/qr'&&!remote&&req.method==='GET'&&mobileConfig){const name=url.searchParams.get('kind')==='tailscale'?'tailscale.png':'lan.png';res.writeHead(200,{'Content-Type':'image/png'});return res.end(await readFile(path.join(path.dirname(mobileConfig.ca),name)));}
      if(req.method==='GET'&&p==='/api/connections')return json(res,200,{machineId:config.machineId,defaultConnection:config.defaultConnection,data:[...managers].map(([id,m])=>({id,host:publicHost(m.host),connection:m.connection}))});
      if(req.method==='GET'&&p==='/api/system/update'){if(url.searchParams.get('check')==='1')void updater.checkLatest?.().catch(()=>{});return json(res,200,await updater.status());}
      if(req.method==='GET'&&p==='/api/version')return json(res,200,{version:buildVersion,machineId:config.machineId});
      const targetKey=url.searchParams.get('host')||config.defaultConnection;
      const manager=managers.get(targetKey);
      if(!manager)throw new AppError('未知连接。',404,'UNKNOWN_HOST');
      if(req.method==='GET'&&p==='/api/csrf')return json(res,200,{token:csrf});
      if(req.method==='GET'&&p==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(`data: ${JSON.stringify({method:'manager/status',params:manager.status()})}\n\n`);res.targetKey=targetKey;clients.add(res);
        for(const request of manager.status().pendingRequests||[])res.write(`data: ${JSON.stringify({method:'manager/request',params:request})}\n\n`);
        const heartbeat=setInterval(()=>{if(remote&&!access.valid(req)){res.end();clients.delete(res);}else res.write(': ping\n\n');},15000);
        res.mobileRequest=remote?req:null;
        const sendUpdate=(data:unknown)=>{if(res.destroyed||res.writableEnded)return;if(res.writableLength>8*1024*1024){res.destroy();return;}res.write(`event: system/update\ndata: ${JSON.stringify(data)}\n\n`);};
        const unsubscribe=updater.subscribe?.(sendUpdate);
        void updater.status().then(sendUpdate).catch(()=>{});
        res.once('close',()=>{clearInterval(heartbeat);unsubscribe?.();clients.delete(res);});return;
      }
      if(req.method==='GET'){const route=routesFor(manager).get('GET '+p);if(route){await route(url,undefined,res);return;}}
      if(req.method==='GET'&&p==='/api/system/deployment-status'){if(remote)throw new AppError('仅限本机部署检查。',403);return json(res,200,await deploymentStatus(manager));}
      const desktopMatch=p.match(/^\/api\/desktop\/threads\/([0-9a-f-]{36})(?:\/(history|message|interrupt|acknowledge))?$/i);
      if(req.method==='GET'&&p==='/api/desktop/candidates')return json(res,200,await manager.passive('threads',{search:url.searchParams.get('search')||'',cursor:url.searchParams.get('cursor')}));
      if(req.method==='GET'&&desktopMatch){const session=desktopSession(targetKey,desktopMatch[1]);if(!desktopMatch[2])return json(res,200,await session.detail());if(desktopMatch[2]==='history')return json(res,200,await session.history(url.searchParams.get('cursor'),desktopMatch[1]));}
      if(req.method==='GET'&&p==='/api/automations')return json(res,200,await automations.get(targetKey)!.list());
      if(req.method==='GET'&&p==='/api/automations/candidates')return json(res,200,await automations.get(targetKey)!.candidates(url.searchParams.get('search')||''));
      if(req.method==='GET'&&p==='/api/automations/history')return json(res,200,await automations.get(targetKey)!.history(url.searchParams.get('cursor'),url.searchParams.get('threadId')));
      if(req.method==='GET'&&p==='/api/automations/session')return json(res,200,await automations.get(targetKey)!.detail());
      if(req.method==='GET'&&p==='/api/composer')return json(res,200,await composerCatalog(manager,url.searchParams.get('cwd'),url.searchParams.get('kind')));
      if(req.method==='GET'&&p==='/api/sidebar/activity')return json(res,200,await readSidebarActivity(manager,Object.fromEntries(url.searchParams)));
      if(req.method==='GET'&&p==='/api/sidebar')return json(res,200,await readSidebar(manager,Object.fromEntries(url.searchParams)));
      if(req.method==='GET'&&p==='/api/project-folders')return json(res,200,await browseFolders(manager,url.searchParams.get('path')));
      const fileMatch=p.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/file$/);
      if(['GET','HEAD'].includes(req.method||'')&&fileMatch){await fileResponse(manager,req,res,fileMatch[1],fileMatch[2],url);return;}
      const image=p.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/image$/);
      if(req.method==='GET'&&image){
        const result=await manager.image(image[1],image[2],{preview:url.searchParams.get('preview')==='1',part:url.searchParams.get('part'),reference:url.searchParams.get('reference')});
        const content=Buffer.from(result.data,'base64');
        if(!['image/png','image/jpeg','image/webp','image/gif'].includes(result.mime))throw new AppError('不支持此图片格式。');
        res.writeHead(200,{'Content-Type':result.mime,'Content-Length':content.length,'Cache-Control':'private, max-age=300',...(url.searchParams.get('download')==='1'?{'Content-Disposition':`attachment; filename="${image[2]}.${result.extension}"`}:{})});res.end(content);return;
      }
      const match=matchThreadRoute(p);
      if(req.method==='GET'){const route=threadRoutesFor(manager).read(p,match);if(route){await route(req,res,url,undefined);return;}}
      if(req.method==='POST'){
        const token=req.headers['x-csrf-token']||'';
        if(typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(token),Buffer.from(csrf)))throw new AppError('本机会话已变化。请刷新页面。',403,'CSRF');
        const data=await body(req,/^\/api\/threads\/[A-Za-z0-9_-]+\/(message|steer|queue-add)$/.test(p)?6*1024*1024:1024*1024);
        if(p==='/api/system/update'){if((server.address() as AddressInfo|null)?.port!==4317&&!providedManagers)throw new AppError('开发预览不能更新正式服务。',409);if(Object.keys(data).length)throw new AppError('更新接口不接受仓库、版本或会话参数。');return json(res,202,await updater.start());}
        if(p==='/api/project-folders')return json(res,200,await createFolder(manager,data));
        if(p==='/api/projects/open')return json(res,200,await openFolderProject(manager,data));
        if(desktopMatch){const session=desktopSession(targetKey,desktopMatch[1]),payload={...data,threadId:desktopMatch[1]};const fn={message:()=>session.send(payload),interrupt:()=>session.interrupt(payload),acknowledge:()=>session.acknowledge(payload)}[desktopMatch[2]];if(fn)return json(res,200,await fn());}
        if(match&&desktopSessions.get(targetKey+':'+match[1])?.pending)throw new AppError('桌面发送仍在确认中，请稍后重试。',409,'SEND_PENDING');
        if(p==='/api/automations/binding')return json(res,200,await automations.get(targetKey)!.bind(data.threadId));
        if(p==='/api/automations/interrupt')return json(res,200,await automations.get(targetKey)!.interrupt(data));
        if(p==='/api/automations/message')return json(res,200,await automations.get(targetKey)!.send(data));
        if(p==='/api/automations/acknowledge')return json(res,200,await automations.get(targetKey)!.acknowledge(data));
        if(match&&match[1]===automations.get(targetKey)!.state.threadId&&match[2])throw new AppError('此管理会话由桌面执行，请从定时任务入口继续。',409,'DESKTOP_MANAGED');
        if(p==='/api/sidebar/actions')return json(res,200,await sidebarAction(manager,data));
        if(p==='/api/access/setup'&&!remote){if(!setupMobile)throw new AppError('此入口不支持配置手机访问。请在本机正式服务中操作。',409);if(data.mode!==undefined&&!['lan','tailscale'].includes(data.mode))throw new AppError('未知手机访问方式。');mobileConfig=await setupMobile(data.mode||'lan');context.setMobileConfig(mobileConfig);return json(res,200,{ok:true});}
        if(p==='/api/access/code'&&!remote){if(!mobileConfig?.origins?.length)throw new AppError('请先配置手机访问地址，再生成配对码。',409,'MOBILE_NOT_CONFIGURED');return json(res,200,access.createCode(data.ttlSeconds,data.sessionTtlSeconds));}
        if(p==='/api/access/revoke'&&!remote){access.revoke();for(const client of clients)if(client.mobileRequest){client.end();clients.delete(client);}return json(res,200,{ok:true});}
        if(p==='/api/access/logout'){access.logout(req);res.setHeader('Set-Cookie',access.cookie());for(const client of clients)if(client.mobileRequest&&!access.valid(client.mobileRequest)){client.end();clients.delete(client);}return json(res,200,{ok:true});}
        const connectionRoute=routesFor(manager).get('POST '+p);if(connectionRoute){await connectionRoute(url,data,res);return;}
        const threadRoute=threadRoutesFor(manager).write(p,match);if(threadRoute){await threadRoute(req,res,url,data);return;}
        const approval=p.match(/^\/api\/requests\/([^/]+)\/respond$/);
        if(approval)return json(res,200,manager.respond(decodeURIComponent(approval[1]),data));
      }
      if(p.startsWith('/api/'))return json(res,404,{error:{message:'找不到此接口。',code:'NOT_FOUND'}});
      if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('不支持此请求方法。',405);
      const file=extraAssets[p]||{'/process-summary.js':'process-summary.js','/turn-files.js':'turn-files.js','/turn-files.css':'turn-files.css','/goal-toolbar.js':'goal-toolbar.js','/queued-inputs.js':'queued-inputs.js','/composer-clipboard.js':'composer-clipboard.js','/response-annotations.js':'response-annotations.js','/selection-tools.css':'selection-tools.css','/side-chat.js':'side-chat.js','/shared/side-chat-events.js':'../shared/side-chat-events.js','/turn-navigation.js':'turn-navigation.js','/turn-navigation.css':'turn-navigation.css','/shared/account-state.js':'../shared/account-state.js','/shared/questions.js':'../shared/questions.js','/shared/connection-state.js':'../shared/connection-state.js','/render-cache.js':'render-cache.js','/feedback.js':'feedback.js','/feedback.css':'feedback.css','/capacity-retry.js':'capacity-retry.js','/system-update.js':'system-update.js','/account-usage.js':'account-usage.js','/login.js':'login.js','/bootstrap.js':'bootstrap.js','/manifest.webmanifest':'manifest.webmanifest','/notification-platform.js':'notification-platform.js','/notification-worker.js':'notification-worker.js','/notification-delivery.js':'notification-delivery.js','/automations.js':'automations.js','/automations.css':'automations.css','/questions.js':'questions.js','/question-form.js':'question-form.js','/message-files.js':'message-files.js','/recovery-state.js':'recovery-state.js','/activity.js':'activity.js','/project-picker.js':'project-picker.js','/project-picker.css':'project-picker.css','/message-media.js':'message-media.js','/message-time.js':'message-time.js','/message-body.js':'message-body.js','/message-dom.js':'message-dom.js','/new-chat.js':'new-chat.js','/new-chat.css':'new-chat.css','/inline-mentions.js':'inline-mentions.js','/skill-suggestions.js':'skill-suggestions.js','/attachments.js':'attachments.js','/goal-submit.js':'goal-submit.js','/composer.js':'composer.js','/composer.css':'composer.css','/':'index.html','/index.html':'index.html','/app.js':'app.js','/mobile-ui.js':'mobile-ui.js','/mobile-ui.css':'mobile-ui.css','/input-state.js':'input-state.js','/thread-sync.js':'thread-sync.js','/thread-handoff.js':'thread-handoff.js','/handoff.css':'handoff.css','/sidebar.js':'sidebar.js','/sidebar.css':'sidebar.css','/browser-backup.js':'browser-backup.js','/connection-state.js':'connection-state.js','/output-window.js':'output-window.js','/detail-cache.js':'detail-cache.js','/styles.css':'styles.css','/voice.js':'voice.js','/mobile.js':'mobile.js'}[p];
      if(!file){res.writeHead(404);res.end('Not found');return;}
      await staticResponse(req,res,path.join(staticRoot,file));
    }catch(caught){const error=caught as {status?:number;message?:string;code?:string;details?:unknown};if(res.headersSent){res.destroy();return;}json(res,error.status||502,{error:{message:error.message,code:error.code||'REMOTE_ERROR',...(error.details?{details:error.details}:{})}});}
  };
}
