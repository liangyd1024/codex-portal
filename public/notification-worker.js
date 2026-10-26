// Notification delivery only: no fetch interception, offline cache or task execution.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
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
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>new URL(item.url).origin===self.location.origin && new URL(item.url).searchParams.get('host')===(host || null));
    if(client){await client.focus();client.postMessage({type:'rcm-notification-click',host,threadId});}
    else {const url=new URL('/',self.location.origin);if(host)url.searchParams.set('host',host);if(threadId)url.searchParams.set('thread',threadId);await self.clients.openWindow(url.href);}
  })());
});
