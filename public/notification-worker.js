// Notification delivery and durable click intent only; no fetch interception or task execution.
const clickCache=()=>caches.open('rcm-notification-click');
const clickKey='/__notification-click';
let clickWork=Promise.resolve();
function serializeClick(work){const next=clickWork.then(work);clickWork=next.catch(()=>{});return next;}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type==='rcm-notification-ready')event.waitUntil(serializeClick(async()=>{
    const saved=await (await clickCache()).match(clickKey);
    if(saved)event.source?.postMessage(await saved.json());
  }));
  if(event.data?.type==='rcm-notification-consumed')event.waitUntil(serializeClick(async()=>{
    const cache=await clickCache(),saved=await cache.match(clickKey);
    if(saved&&(await saved.json()).clickId===event.data.clickId)await cache.delete(clickKey);
  }));
  if(event.data?.type==='rcm-push-version')event.ports?.[0]?.postMessage({version:2});
});
self.addEventListener('push',event=>{
  let message;try{message=event.data?.json();}catch{}
  const notice=message?.notification||message;
  event.waitUntil((async()=>{
    let error;
    try{await self.registration.showNotification(notice?.title||'Codex · 新通知',{body:notice?.body||'打开应用查看',tag:notice?.tag,data:notice?.data||{},navigate:notice?.navigate,silent:false});}
    catch(caught){error=String(caught.message||caught);}
    // A test receipt distinguishes provider acceptance from device handling.
    if(notice?.data?.testId){
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const client of windows)client.postMessage({type:'rcm-push-receipt',testId:notice.data.testId,error});
    }
    if(error)throw Error(error);
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const {host,threadId}=event.notification.data || {};
  event.waitUntil(serializeClick(async()=>{
    const target={type:'rcm-notification-click',host,threadId,clickId:crypto.randomUUID()};
    if(threadId)await (await clickCache()).put(clickKey,new Response(JSON.stringify(target)));
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>new URL(item.url).origin===self.location.origin && (new URL(item.url).searchParams.get('host')===(host || null)||!new URL(item.url).searchParams.has('host')));
    if(client){await client.focus();client.postMessage(target);}
    else {const url=new URL('/',self.location.origin);if(host)url.searchParams.set('host',host);if(threadId)url.searchParams.set('thread',threadId);const opened=await self.clients.openWindow(url.href);opened?.postMessage?.(target);}
  }));
});
