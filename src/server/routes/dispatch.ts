import type {PushNotifications} from '../services/push-notifications';
import {createHash} from 'node:crypto';
import {discoverConnection} from '../../../lib/connection-discovery.mjs';
import {probeConnection} from '../../../lib/connection-config.mjs';
import type {ConnectionConfigStore} from '../../../lib/connection-config.mjs';
import {createLocalOriginMatcher} from '../local-origin';
import type {IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {Response,MobileConfig} from '../types';
import type {ApplicationOptions} from '../types';
import {createThreadRoutes,matchThreadRoute} from './threads';
import {createStaticResponse} from '../../../lib/http/static-response.mjs';
import {createSystemRoutes} from './system';
import {createEventRoute,createThreadViewRoute} from './events';
import {WebUpdate} from '../services/web-update';
import {createConnectionRoutes} from './connections';
import {createWorkspaceRoutes} from './workspace';
import {createDesktopRoutes,matchDesktopRoute} from './desktop';
import {createMediaRoutes} from './media';
import {json,body} from '../protocol';
import {MobileAccess} from '../services/mobile-access';
import {createAccessRoutes} from './access';
import {matchRequestRoute,respondRequest} from './requests';
import {createStaticRoutes} from './static';
import {timingSafeEqual} from 'node:crypto';
import {Manager,AppError} from '../../../lib/manager.mjs';
import {NativeAutomations} from '../../../lib/native-automations.mjs';

export interface RouteServices {
 push?:PushNotifications;
 connectionWrites:Map<string,number>;registry:ConnectionConfigStore|null;changeConnections:((data:Record<string,unknown>)=>Promise<unknown>)|null;
 config:import('../types').Config; managers:Map<string,Manager>; automations:Map<string,NativeAutomations>;
 desktopSessions:Map<string,NativeAutomations>;desktopSession:(host:string,id:string)=>NativeAutomations;
 csrf:string;clients:Set<Response>;staticResponse:ReturnType<typeof createStaticResponse>;
 access:MobileAccess;setupMobile:ApplicationOptions['setupMobile'];updater:WebUpdate;
 providedManagers:ApplicationOptions['managers'];buildVersion:string;staticRoot:string;extraAssets:Record<string,string>;
 server:()=>import('node:http').Server;mobileConfig:()=>MobileConfig|null;setMobileConfig:(value:MobileConfig)=>void;
}
export function createDispatcher(context:RouteServices){
 const localOrigin=createLocalOriginMatcher();
 const staticRoutes=createStaticRoutes(context);
 const accessRoutes=createAccessRoutes(context);
 const systemRoutes=createSystemRoutes(context);
 const openEvents=createEventRoute(context);
 const threadView=createThreadViewRoute(context);
 const workspaceRoutes=new WeakMap<Manager,ReturnType<typeof createWorkspaceRoutes>>();
 const workspaceRoutesFor=(manager:Manager)=>{let routes=workspaceRoutes.get(manager);if(!routes){routes=createWorkspaceRoutes(manager);workspaceRoutes.set(manager,routes);}return routes;};
 const desktopRoutes=new WeakMap<Manager,ReturnType<typeof createDesktopRoutes>>();
 const desktopRoutesFor=(host:string,manager:Manager)=>{let routes=desktopRoutes.get(manager);if(!routes){routes=createDesktopRoutes(manager,context.automations.get(host)!,id=>context.desktopSession(host,id),(id,turns)=>context.push?.observe(host,id,turns));desktopRoutes.set(manager,routes);}return routes;};
 const mediaRoutes=new WeakMap<Manager,ReturnType<typeof createMediaRoutes>>();
 const mediaRoutesFor=(manager:Manager)=>{let routes=mediaRoutes.get(manager);if(!routes){routes=createMediaRoutes(manager);mediaRoutes.set(manager,routes);}return routes;};
 const threadRoutes=new WeakMap<Manager,ReturnType<typeof createThreadRoutes>>();
 const threadRoutesFor=(manager:Manager)=>{let routes=threadRoutes.get(manager);if(!routes){routes=createThreadRoutes(manager,(id,turns)=>{const host=[...context.managers].find(([,value])=>value===manager)?.[0];if(host)context.push?.observe(host,id,turns);});threadRoutes.set(manager,routes);}return routes;};
 const connectionRoutes=new WeakMap<Manager,ReturnType<typeof createConnectionRoutes>>();
 const routesFor=(manager:Manager)=>{let routes=connectionRoutes.get(manager);if(!routes){routes=createConnectionRoutes(manager);connectionRoutes.set(manager,routes);}return routes;};
 const {config,managers,automations,desktopSessions,csrf,access}=context;
  return async(req:IncomingMessage,res:Response,remote=false)=>{
    const server=context.server();const mobileConfig=context.mobileConfig();
    res.allowGzip=String(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;|\s*$)/i.test(part.trim())&&!/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(part));
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let writingTarget:string|undefined;
    try {
      // Host and origin checks protect the local control API against DNS rebinding and drive-by sites.
      const port=(server.address() as AddressInfo|null)?.port;
      const origin=remote ? mobileConfig?.origins.find(value=>new URL(value).host===req.headers.host) : localOrigin(port,req.headers.host);
      if(!origin)throw new AppError('访问地址未获授权。',403,'FORBIDDEN');
      if((req.headers.origin&&req.headers.origin!==origin)||(remote&&req.method==='POST'&&req.headers.origin!==origin))throw new AppError('不允许跨站访问。',403,'FORBIDDEN');
      const url=new URL(req.url!,origin);const p=url.pathname;
      if(p==='/api/access/login'&&remote&&req.method==='POST'){await accessRoutes.login(req,res);return;}
      // The browser can refresh a background receiver without the page's pairing
      // cookie. This exact static script contains no user data; APIs stay paired.
      if(p==='/notification-worker.js'&&(req.method==='GET'||req.method==='HEAD')){await staticRoutes.read(req,res,p);return;}
      if(remote&&!access.valid(req)){
        if(req.method==='GET'&&staticRoutes.isLoginAsset(p)){await staticRoutes.login(p,res);return;}
        throw new AppError('请先使用本机生成的配对码登录。',401,'PAIRING_REQUIRED');
      }
      if(remote&&access.expires(req)===null)res.setHeader('Set-Cookie',access.cookie(access.token(req)));
      if(req.method==='GET'){const route=accessRoutes.read(p,remote,mobileConfig);if(route){await route(req,res,url);return;}}
      if(req.method==='GET'){const route=systemRoutes.read(p);if(route){await route(url,res);return;}}
      if(req.method==='GET'&&p==='/api/connection-config'){if(!context.registry)throw new AppError('此预览不支持修改连接配置。',409);return json(res,200,context.registry.snapshot());}
      const targetKey=url.searchParams.get('host')||config.defaultConnection;
      const manager=managers.get(targetKey);
      if(!manager)throw new AppError('未知连接。',404,'UNKNOWN_HOST');
      if(req.method==='GET'&&p==='/api/push/trace')return json(res,200,{data:context.push?.traces(remote?createHash('sha256').update(access.token(req)).digest('hex'):undefined)||[]});
      if(req.method==='GET'&&p==='/api/push/devices'){if(remote)throw new AppError('仅本机可检查推送设备。',403);return json(res,200,{data:context.push?.devices(targetKey)||[]});}
      if(req.method==='GET'&&p==='/api/push/key')return json(res,200,{publicKey:context.push?.publicKey()});
      if(req.method==='GET'&&p==='/api/csrf')return json(res,200,{token:csrf});
      if(req.method==='GET'&&p==='/api/events'){
        openEvents(req,res,manager,targetKey,remote,url);return;
      }
      if(req.method==='GET'){const route=routesFor(manager).get('GET '+p);if(route){await route(url,undefined,res);return;}}
      if(req.method==='GET'&&p==='/api/system/deployment-status'){await systemRoutes.deployment(manager,remote,res);return;}
      const desktopMatch=matchDesktopRoute(p);
      if(req.method==='GET'){const route=desktopRoutesFor(targetKey,manager).read(p,desktopMatch);if(route){await route(url,undefined,res);return;}}
      if(req.method==='GET'){const route=workspaceRoutesFor(manager).get('GET '+p);if(route){await route(url,undefined,res);return;}}
      const mediaRoute=mediaRoutesFor(manager).read(req.method,p);if(mediaRoute){await mediaRoute(req,res,url);return;}
      const match=matchThreadRoute(p);
      if(req.method==='GET'){const route=threadRoutesFor(manager).read(p,match);if(route){await route(req,res,url,undefined);return;}}
      if(req.method==='POST'){
        const token=req.headers['x-csrf-token']||'';
        if(typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(token),Buffer.from(csrf)))throw new AppError('本机会话已变化。请刷新页面。',403,'CSRF');
        if(context.registry&&req.headers['x-rcm-config-revision']!==context.registry.revision)throw new AppError('连接配置已变化，请保存草稿并刷新页面。',409,'CONFIG_CONFLICT');
        const data=await body(req,/^\/api\/threads\/[A-Za-z0-9_-]+\/(message|steer|queue-add)$/.test(p)?6*1024*1024:1024*1024);
        if(p.startsWith('/api/push/')&&context.push){
          const owner=remote?createHash('sha256').update(access.token(req)).digest('hex'):'local';
          if(p==='/api/push/trace')return json(res,200,context.push.trace(targetKey,owner,data));
          if(p==='/api/push/subscribe')return json(res,200,context.push.subscribe(targetKey,owner,origin,data.subscription));
          if(p==='/api/push/unsubscribe')return json(res,200,context.push.remove(targetKey,owner,data.endpoint));
          if(p==='/api/push/test-device'){if(remote)throw new AppError('仅本机可测试指定设备。',403);return json(res,200,await context.push.testDevice(targetKey,data.deviceId,data.testId,data.threadId,data.diagnostic));}
          if(p==='/api/push/test')return json(res,200,await context.push.test(targetKey,owner,data.endpoint,data.testId,data.threadId,data.diagnostic));
        }
        if(p==='/api/connection-discover'){if(!context.registry)throw new AppError('此入口不支持添加机器。',409);return json(res,200,await discoverConnection(data.connection||{}));}
        if(p==='/api/connection-probe'){if(!context.registry)throw new AppError('此预览不支持连接检测。',409);return json(res,200,await probeConnection(context.config,data));}
        if(p==='/api/connection-config'){if(!context.changeConnections)throw new AppError('此预览不支持修改连接配置。',409);return json(res,200,await context.changeConnections(data));}
        if(context.registry?.writing)throw new AppError('连接配置正在保存，请稍后重试。',409,'CONFIG_BUSY');
        writingTarget=targetKey;context.connectionWrites.set(targetKey,(context.connectionWrites.get(targetKey)||0)+1);
        if(p==='/api/system/update'){await systemRoutes.update(data,(server.address() as AddressInfo|null)?.port,res);return;}
        if(p==='/api/project-folders'||p==='/api/projects/open'){await workspaceRoutesFor(manager).get('POST '+p)!(url,data,res);return;}
        const desktopRoute=desktopRoutesFor(targetKey,manager).desktopWrite(desktopMatch);if(desktopRoute){await desktopRoute(url,data,res);return;}
        if(match&&desktopSessions.get(targetKey+':'+match[1])?.pending)throw new AppError('桌面发送仍在确认中，请稍后重试。',409,'SEND_PENDING');
        const automationRoute=desktopRoutesFor(targetKey,manager).automationWrite(p);if(automationRoute){await automationRoute(url,data,res);return;}
        if(match&&match[1]===automations.get(targetKey)!.state.threadId&&match[2])throw new AppError('此管理会话由桌面执行，请从定时任务入口继续。',409,'DESKTOP_MANAGED');
        if(p==='/api/sidebar/actions'){await workspaceRoutesFor(manager).get('POST '+p)!(url,data,res);return;}
        const accessRoute=accessRoutes.write(p,remote,mobileConfig);if(accessRoute){await accessRoute(req,res,data);return;}
        const connectionRoute=routesFor(manager).get('POST '+p);if(connectionRoute){await connectionRoute(url,data,res);return;}
        if(p==='/api/thread-view'){await threadView(req,res,manager,targetKey,remote,data);return;}
        const threadRoute=threadRoutesFor(manager).write(p,match);if(threadRoute){await threadRoute(req,res,url,data);return;}
        const approval=matchRequestRoute(p);
        if(approval)return respondRequest(manager,approval,data,res);
      }
      if(p.startsWith('/api/'))return json(res,404,{error:{message:'找不到此接口。',code:'NOT_FOUND'}});
      await staticRoutes.read(req,res,p);
    }catch(caught){const error=caught as {status?:number;message?:string;code?:string;details?:unknown};if(res.headersSent){res.destroy();return;}json(res,error.status||502,{error:{message:error.message,code:error.code||'REMOTE_ERROR',...(error.details?{details:error.details}:{})}});}
    finally{if(writingTarget){const count=(context.connectionWrites.get(writingTarget)||1)-1;if(count)context.connectionWrites.set(writingTarget,count);else context.connectionWrites.delete(writingTarget);}}
  };
}
