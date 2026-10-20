import {deploymentStatus} from './lib/deployment-status.mjs';
import {WebUpdate} from './lib/web-update.mjs';
import {supportDir} from './lib/config.mjs';
import {readAccountUsage} from './lib/account-usage.mjs';
import {fileResponse} from './lib/file-response.mjs';
import {readSidebar,sidebarAction} from './lib/sidebar.mjs';
import {composerCatalog,setGoal} from './lib/composer.mjs';
import {homedir,networkInterfaces} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {gzip} from 'node:zlib';
import https from 'node:https';
import {MobileAccess} from './lib/mobile-access.mjs';
import {tailscaleHealth} from './lib/tailscale-serve.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {createLocalTransport} from './lib/local.mjs';
import {createSshTransport} from './lib/ssh.mjs';
import {loadConfig,publicHost} from './lib/config.mjs';
import { Manager, AppError } from './lib/manager.mjs';
import {NativeAutomations} from './lib/native-automations.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
let BUILD_VERSION='development';try{BUILD_VERSION=(await readFile(path.join(ROOT,'VERSION'),'utf8')).trim();}catch{}
export function createApp({mobileConfig=null,setupMobile=null,access=new MobileAccess(null),config=loadConfig(),stateDir=process.env.RCM_STATE_DIR||path.join(homedir(),'.codex/remote-codex-manager'),managers:providedManagers,updater=new WebUpdate({supportDir,root:ROOT,version:BUILD_VERSION})}={}) {
 const managers=providedManagers||new Map(config.connections.map(host=>[host.id,new Manager({titleStore:path.join(stateDir,`web-titles-${host.id}.json`),host:publicHost(host),...(host.kind==='local'?createLocalTransport(host):createSshTransport(host))})]));
 const manager=managers.get(config.defaultConnection);
 const automations=new Map([...managers].map(([id,m])=>[id,new NativeAutomations(m)]));
  const broadcasts=new Map();
  const csrf=randomBytes(32).toString('hex'); const clients=new Set();

  for(const [key,target] of managers){const listener=event=>{for(const client of clients){if(client.targetKey!==key)continue;if(client.writableLength>8*1024*1024){client.destroy();clients.delete(client);}else client.write(`data: ${JSON.stringify(event)}\n\n`);}};broadcasts.set(key,listener);target.on('event',listener);}
  function json(res,status,data){
    const text=JSON.stringify(data),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding'};
    if(res.allowGzip&&text.length>65536){gzip(text,{level:1},(error,packed)=>{if(res.destroyed)return;if(error){res.writeHead(status,headers);res.end(text);}else{res.writeHead(status,{...headers,'Content-Encoding':'gzip'});res.end(packed);}});return;}
    res.writeHead(status,headers);res.end(text);
  }
  async function body(req,limit=1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError('请求过大。',413);chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8');try{return text?JSON.parse(text):{};}catch{throw new AppError('请求不是有效的 JSON。');}}
  const handler=async(req,res,remote=false)=>{
    res.allowGzip=String(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;|\s*$)/i.test(part.trim())&&!/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(part));
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Host and origin checks protect the local control API against DNS rebinding and drive-by sites.
      const port=server.address()?.port;
      const origin=remote ? mobileConfig?.origins.find(value=>new URL(value).host===req.headers.host) : [`http://127.0.0.1:${port}`,`http://localhost:${port}`].find(value=>new URL(value).host===req.headers.host);
      if(!origin)throw new AppError('访问地址未获授权。',403,'FORBIDDEN');
      if((req.headers.origin&&req.headers.origin!==origin)||(remote&&req.method==='POST'&&req.headers.origin!==origin))throw new AppError('不允许跨站访问。',403,'FORBIDDEN');
      const url=new URL(req.url,origin);const p=url.pathname;
      if(p==='/api/access/login'&&remote&&req.method==='POST'){
        const data=await body(req);
        const token=access.login(data.code);res.setHeader('Set-Cookie',access.cookie(token));return json(res,200,{ok:true});
      }
      if(remote&&!access.valid(req)){
        if(req.method==='GET'&&['/','/index.html','/login.js','/styles.css','/mobile-ui.css'].includes(p)){
          const file=p==='/login.js'?'login.js':p==='/styles.css'?'styles.css':p==='/mobile-ui.css'?'mobile-ui.css':'login.html';
          res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(ROOT,'public',file)));
        }
        throw new AppError('请先使用本机生成的配对码登录。',401,'PAIRING_REQUIRED');
      }
      if(remote&&access.expires(req)===null)res.setHeader('Set-Cookie',access.cookie(access.token(req)));
      if(p==='/api/access/status'&&req.method==='GET')return json(res,200,{local:!remote,sessionExpires:remote?access.expires(req):undefined,origins:remote?[]:mobileConfig?.origins||[],canSetup:!remote&&Boolean(setupMobile),tailscaleStatus:!remote&&mobileConfig?.origins.some(origin=>new URL(origin).hostname.endsWith('.ts.net'))?await tailscaleHealth():undefined});
      if(p==='/api/access/ca'&&!remote&&req.method==='GET'&&mobileConfig){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="Codex-Local-CA.crt"'});return res.end(await readFile(mobileConfig.ca));}
      if(p==='/api/access/qr'&&!remote&&req.method==='GET'&&mobileConfig){const name=url.searchParams.get('kind')==='tailscale'?'tailscale.png':'lan.png';res.writeHead(200,{'Content-Type':'image/png'});return res.end(await readFile(path.join(path.dirname(mobileConfig.ca),name)));}
      if(req.method==='GET'&&p==='/api/connections')return json(res,200,{machineId:config.machineId,defaultConnection:config.defaultConnection,data:[...managers].map(([id,m])=>({id,host:publicHost(m.host),connection:m.connection}))});
      if(req.method==='GET'&&p==='/api/system/update')return json(res,200,await updater.status());
      if(req.method==='GET'&&p==='/api/version')return json(res,200,{version:BUILD_VERSION,machineId:config.machineId});
      const targetKey=url.searchParams.get('host')||config.defaultConnection;
      const manager=managers.get(targetKey);
      if(!manager)throw new AppError('未知连接。',404,'UNKNOWN_HOST');
      if(req.method==='GET'&&p==='/api/csrf')return json(res,200,{token:csrf});
      if(req.method==='GET'&&p==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(`data: ${JSON.stringify({method:'manager/status',params:manager.status()})}\n\n`);res.targetKey=targetKey;clients.add(res);
        for(const event of manager.replayNotices?.()||[])res.write(`data: ${JSON.stringify(event)}\n\n`);
        for(const request of manager.status().pendingRequests||[])res.write(`data: ${JSON.stringify({method:'manager/request',params:request})}\n\n`);
        const heartbeat=setInterval(()=>{if(remote&&!access.valid(req)){res.end();clients.delete(res);}else res.write(': ping\n\n');},15000);
        res.mobileRequest=remote?req:null;
        req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;
      }
      if(req.method==='GET'&&p==='/api/account/usage')return json(res,200,await readAccountUsage(manager));
      if(req.method==='GET'&&p==='/api/system/deployment-status'){if(remote)throw new AppError('仅限本机部署检查。',403);return json(res,200,await deploymentStatus(manager));}
      if(req.method==='GET'&&p==='/api/status')return json(res,200,manager.status());
      if(req.method==='GET'&&p==='/api/automations')return json(res,200,await automations.get(targetKey).list());
      if(req.method==='GET'&&p==='/api/automations/candidates')return json(res,200,await automations.get(targetKey).candidates(url.searchParams.get('search')||''));
      if(req.method==='GET'&&p==='/api/automations/history')return json(res,200,await automations.get(targetKey).history(url.searchParams.get('cursor'),url.searchParams.get('threadId')));
      if(req.method==='GET'&&p==='/api/automations/session')return json(res,200,await automations.get(targetKey).detail());
      if(req.method==='GET'&&p==='/api/composer')return json(res,200,await composerCatalog(manager,url.searchParams.get('cwd'),url.searchParams.get('kind')));
      if(req.method==='GET'&&p==='/api/models'){manager.requireConnected();return json(res,200,{data:url.searchParams.get('refresh')==='1'||!manager.models.length?await manager.refreshCatalog('models'):manager.models,nextCursor:null});}
      if(req.method==='GET'&&p==='/api/sidebar')return json(res,200,await readSidebar(manager,Object.fromEntries(url.searchParams)));
      if(req.method==='GET'&&p==='/api/projects')return json(res,200,{data:await manager.refreshCatalog('projects')});
      if(req.method==='GET'&&p==='/api/threads')return json(res,200,await manager.threads(Object.fromEntries(url.searchParams)));
      const fileMatch=p.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/file$/);
      if(['GET','HEAD'].includes(req.method)&&fileMatch){await fileResponse(manager,req,res,fileMatch[1],fileMatch[2],url);return;}
      const image=p.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})\/items\/([A-Za-z0-9_-]{1,160})\/image$/);
      if(req.method==='GET'&&image){
        const result=await manager.image(image[1],image[2],{preview:url.searchParams.get('preview')==='1',part:url.searchParams.get('part'),reference:url.searchParams.get('reference')});
        const content=Buffer.from(result.data,'base64');
        if(!['image/png','image/jpeg','image/webp','image/gif'].includes(result.mime))throw new AppError('不支持此图片格式。');
        res.writeHead(200,{'Content-Type':result.mime,'Content-Length':content.length,'Cache-Control':'private, max-age=300',...(url.searchParams.get('download')==='1'?{'Content-Disposition':`attachment; filename="${image[2]}.${result.extension}"`}:{})});res.end(content);return;
      }
      const match=p.match(/^\/api\/threads\/([A-Za-z0-9_-]{1,160})(?:\/(history|takeover|handoff|message|steer|interrupt|goal|question-answer))?$/);
      if(req.method==='GET'&&match){const[,id,action]=match;if(action==='history')return json(res,200,await manager.history(id,url.searchParams.get('cursor')));if(!action)return json(res,200,await manager.detail(id,JSON.parse(req.headers['x-output-versions']||'{}'),url.searchParams.get('preview')==='1',url.searchParams.get('outputEncoding'),url.searchParams.get('fast')==='1'));}
      if(req.method==='POST'){
        const token=req.headers['x-csrf-token']||'';
        if(typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(token),Buffer.from(csrf)))throw new AppError('本机会话已变化。请刷新页面。',403,'CSRF');
        const data=await body(req,/^\/api\/threads\/[A-Za-z0-9_-]+\/(message|steer)$/.test(p)?6*1024*1024:1024*1024);
        if(p==='/api/system/update'){if(server.address()?.port!==4317&&!providedManagers)throw new AppError('开发预览不能更新正式服务。',409);if(Object.keys(data).length)throw new AppError('更新接口不接受仓库、版本或会话参数。');return json(res,202,await updater.start());}
        if(p==='/api/automations/binding')return json(res,200,await automations.get(targetKey).bind(data.threadId));
        if(p==='/api/automations/interrupt')return json(res,200,await automations.get(targetKey).interrupt(data));
        if(p==='/api/automations/message')return json(res,200,await automations.get(targetKey).send(data));
        if(p==='/api/automations/acknowledge')return json(res,200,await automations.get(targetKey).acknowledge(data));
        if(match&&match[1]===automations.get(targetKey).state.threadId&&match[2])throw new AppError('此管理会话由桌面执行，请从定时任务入口继续。',409,'DESKTOP_MANAGED');
        if(p==='/api/sidebar/actions')return json(res,200,await sidebarAction(manager,data));
        if(p==='/api/access/setup'&&!remote){if(!setupMobile)throw new AppError('此入口不支持配置手机访问。请在本机正式服务中操作。',409);if(data.mode!==undefined&&!['lan','tailscale'].includes(data.mode))throw new AppError('未知手机访问方式。');mobileConfig=await setupMobile(data.mode||'lan');return json(res,200,{ok:true});}
        if(p==='/api/access/code'&&!remote){if(!mobileConfig?.origins?.length)throw new AppError('请先配置手机访问地址，再生成配对码。',409,'MOBILE_NOT_CONFIGURED');return json(res,200,access.createCode(data.ttlSeconds,data.sessionTtlSeconds));}
        if(p==='/api/access/revoke'&&!remote){access.revoke();for(const client of clients)if(client.mobileRequest){client.end();clients.delete(client);}return json(res,200,{ok:true});}
        if(p==='/api/access/logout'){access.logout(req);res.setHeader('Set-Cookie',access.cookie());for(const client of clients)if(client.mobileRequest&&!access.valid(client.mobileRequest)){client.end();clients.delete(client);}return json(res,200,{ok:true});}
        if(p==='/api/connect'){
          Promise.resolve(manager.connect()).catch(()=>{});
          return json(res,202,manager.status());
        }
        if(p==='/api/notices/ack')return json(res,200,manager.acknowledgeNotice(data.key));
        if(p==='/api/diagnostics/clear')return json(res,200,manager.clearDiagnosticHistory());
        if(p==='/api/disconnect')return json(res,200,manager.disconnect());
        if(p==='/api/service/release')return json(res,200,await manager.release(data));
        if(p==='/api/threads')return json(res,201,await manager.newThread(data));
        if(match){const[,id,action]=match;const fn={'question-answer':()=>manager.answerQuestions(id,data),goal:()=>setGoal(manager,id,data),takeover:()=>manager.takeover(id),handoff:()=>manager.handoff(id),message:()=>manager.message(id,data),steer:()=>manager.steer(id,data),interrupt:()=>manager.interrupt(id)}[action];if(fn)return json(res,200,await fn());}
        const approval=p.match(/^\/api\/requests\/([^/]+)\/respond$/);
        if(approval)return json(res,200,manager.respond(decodeURIComponent(approval[1]),data));
      }
      if(p.startsWith('/api/'))return json(res,404,{error:{message:'找不到此接口。',code:'NOT_FOUND'}});
      if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('不支持此请求方法。',405);
      const file={'/system-update.js':'system-update.js','/account-usage.js':'account-usage.js','/login.js':'login.js','/bootstrap.js':'bootstrap.js','/manifest.webmanifest':'manifest.webmanifest','/notification-platform.js':'notification-platform.js','/notification-worker.js':'notification-worker.js','/notification-delivery.js':'notification-delivery.js','/automations.js':'automations.js','/automations.css':'automations.css','/questions.js':'questions.js','/question-form.js':'question-form.js','/message-files.js':'message-files.js','/recovery-state.js':'recovery-state.js','/activity.js':'activity.js','/project-picker.js':'project-picker.js','/project-picker.css':'project-picker.css','/message-media.js':'message-media.js','/message-time.js':'message-time.js','/message-body.js':'message-body.js','/message-dom.js':'message-dom.js','/new-chat.js':'new-chat.js','/new-chat.css':'new-chat.css','/inline-mentions.js':'inline-mentions.js','/skill-suggestions.js':'skill-suggestions.js','/attachments.js':'attachments.js','/goal-submit.js':'goal-submit.js','/composer.js':'composer.js','/composer.css':'composer.css','/':'index.html','/index.html':'index.html','/app.js':'app.js','/mobile-ui.js':'mobile-ui.js','/mobile-ui.css':'mobile-ui.css','/input-state.js':'input-state.js','/thread-sync.js':'thread-sync.js','/thread-handoff.js':'thread-handoff.js','/handoff.css':'handoff.css','/sidebar.js':'sidebar.js','/sidebar.css':'sidebar.css','/browser-backup.js':'browser-backup.js','/connection-state.js':'connection-state.js','/output-window.js':'output-window.js','/detail-cache.js':'detail-cache.js','/styles.css':'styles.css','/voice.js':'voice.js','/mobile.js':'mobile.js'}[p];
      if(!file){res.writeHead(404);res.end('Not found');return;}
      const content=await readFile(path.join(ROOT,'public',file));
      res.writeHead(200,{'Content-Type':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){if(res.headersSent){res.destroy();return;}json(res,error.status||502,{error:{message:error.message,code:error.code||'REMOTE_ERROR',...(error.details?{details:error.details}:{})}});}
  };
  const server=http.createServer((req,res)=>handler(req,res));
  const proxyServer=http.createServer((req,res)=>handler(req,res,true));
  const createSecureServer=options=>https.createServer(options,(req,res)=>handler(req,res,true));
  server.on('listening',()=>{for(const m of managers.values())Promise.resolve(m.restoreConnection?.()).catch(()=>{});});
  server.on('close',()=>{for(const [key,m] of managers){m.off('event',broadcasts.get(key));m.disconnect({preserveIntent:true});}for(const client of clients)client.end();});
  return {server,manager,managers,proxyServer,createSecureServer,setMobileConfig:value=>{mobileConfig=value;}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const configPath=path.join(homedir(),'Library/Application Support/RemoteCodexManager/mobile/config.json');
  let mobileConfig=null;try{if(process.env.RCM_MOBILE!=='0')mobileConfig=JSON.parse(await readFile(configPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const access=new MobileAccess(path.join(homedir(),'Library/Application Support/RemoteCodexManager/mobile/sessions.json'));
  let setupPending;
  const setupMobile=process.env.RCM_MOBILE==='0'?null:(mode='lan')=>{if(setupPending)throw new AppError('手机入口正在配置，请稍后重新检查。',409);return setupPending=(async()=>{
    await promisify(execFile)(process.execPath,[path.join(ROOT,'scripts/setup-mobile.mjs'),...(mode==='tailscale'?['--tailscale']:[])],{timeout:90000});
    const next=JSON.parse(await readFile(configPath,'utf8'));
    if(!mobileConfig){await startMobile(next);mobileConfig=next;}else{mobileConfig.origins=next.origins;}
    return mobileConfig;
  })().finally(()=>{setupPending=null;});};
  const {server,manager,managers,proxyServer,createSecureServer,setMobileConfig}=createApp({mobileConfig:null,access,setupMobile});
  async function startMobile(initial){
    const mobileConfig=initial;
    const tls=createSecureServer({key:await readFile(mobileConfig.key),cert:await readFile(mobileConfig.cert)});
    const listen=(endpoint,port,host)=>new Promise((resolve,reject)=>{endpoint.once('error',reject);endpoint.listen(port,host,()=>{endpoint.off('error',reject);resolve();});});
    try{await listen(proxyServer,4318,'127.0.0.1');await listen(tls,4319,mobileConfig.lanIP);}catch(error){if(proxyServer.listening)await new Promise(resolve=>proxyServer.close(resolve));throw error;}
    for(const endpoint of [proxyServer,tls])endpoint.on('error',error=>console.error('手机入口：'+error.message));
    let renewing=false,lastRenewal=Date.now();
    const refreshTLS=async()=>{
      if(renewing)return;
      const ips=Object.values(networkInterfaces()).flat().filter(Boolean).filter(n=>n.family==='IPv4'&&!n.internal).map(n=>n.address);
      if(!ips.length||tls.listening&&ips.includes(mobileConfig.lanIP)&&Date.now()-lastRenewal<86400000)return;
      renewing=true;
      try{
        await promisify(execFile)(process.execPath,[path.join(ROOT,'scripts/setup-mobile.mjs')],{timeout:90000});
        const next=JSON.parse(await readFile(configPath,'utf8'));
        const credentials={key:await readFile(next.key),cert:await readFile(next.cert)};
        if(next.lanIP!==mobileConfig.lanIP||!tls.listening){
          if(tls.listening){tls.closeAllConnections();await new Promise(resolve=>tls.close(resolve));}
          Object.assign(mobileConfig,next);tls.setSecureContext(credentials);tls.listen(4319,next.lanIP);
        }else{Object.assign(mobileConfig,next);tls.setSecureContext(credentials);}
        lastRenewal=Date.now();
      }catch(error){console.error('手机证书更新失败：'+error.message);}finally{renewing=false;}
    };
    setInterval(refreshTLS,30000).unref();
  }
  if(mobileConfig){try{await startMobile(mobileConfig);setMobileConfig(mobileConfig);}catch(error){console.error('手机入口启动失败：'+error.message);mobileConfig=null;}}
  const port=Number(process.env.RCM_PORT||4317);
  server.listen(port,'127.0.0.1',()=>console.log(`Remote Codex Manager: http://127.0.0.1:${server.address().port}`));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const m of managers.values())m.disconnect({preserveIntent:true});server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();});
}
