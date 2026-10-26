// Notification delivery and durable click intent only; no fetch interception or task execution.
const clickCache=()=>caches.open('rcm-notification-click');
const clickKey='/__notification-click';
let clickWork=Promise.resolve(), fallbackClick=null;
function serializeClick(work){const next=clickWork.then(work);clickWork=next.catch(()=>{});return next;}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type==='rcm-notification-ready')event.waitUntil(serializeClick(async()=>{
    let target=fallbackClick;
    try{const saved=await (await clickCache()).match(clickKey);if(saved)target=await saved.json();}catch{}
    if(target)event.source?.postMessage(target);
  }));
  if(event.data?.type==='rcm-notification-consumed')event.waitUntil(serializeClick(async()=>{
    if(fallbackClick?.clickId===event.data.clickId)fallbackClick=null;
    try{const cache=await clickCache(),saved=await cache.match(clickKey);
    if(saved&&(await saved.json()).clickId===event.data.clickId)await cache.delete(clickKey);}catch{}
  }));
  if(event.data?.type==='rcm-push-version')event.ports?.[0]?.postMessage({version:2});
});
self.addEventListener('push',event=>{
  let message;try{message=event.data?.json();}catch{}
  const notice=message?.notification||message;
  event.waitUntil((async()=>{
    let error;
    // Replacement notifications use notificationclick; only the declarative fallback
    // uses navigate. Setting navigate here bypasses our durable click/ack handshake.
    try{await self.registration.showNotification(notice?.title||'Codex · 新通知',{body:notice?.body||'打开应用查看',tag:notice?.tag,data:notice?.data||{},silent:false});}
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
  event.waitUntil((async()=>{
    const target={type:'rcm-notification-click',host,threadId,clickId:crypto.randomUUID()};
    // Keep storage ordering separate from window startup: the new page may ask
    // for its target before openWindow/focus resolves.
    if(threadId)await serializeClick(async()=>{
      fallbackClick=target;
      try{await (await clickCache()).put(clickKey,new Response(JSON.stringify(target)));}catch{}
    });
    const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(item=>new URL(item.url).origin===self.location.origin);
    if(threadId&&fallbackClick?.clickId!==target.clickId)return;
    const client=windows.find(item=>new URL(item.url).searchParams.get('host')===(host||null))||windows.find(item=>item.focused)||windows[0];
    if(client){try{await client.focus();if(!threadId||fallbackClick?.clickId===target.clickId)client.postMessage(target);return;}catch{}}
    const url=new URL('/',self.location.origin);
    if(host)url.searchParams.set('host',host);
    if(threadId){url.searchParams.set('thread',threadId);url.searchParams.set('notification-click',target.clickId);}
    const opened=await self.clients.openWindow(url.href);opened?.postMessage?.(target);
  })());
});
