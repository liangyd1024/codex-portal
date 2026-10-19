// Notification delivery only: no fetch interception, offline cache or task execution.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const {host,threadId}=event.notification.data || {};
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>new URL(item.url).origin===self.location.origin && new URL(item.url).searchParams.get('host')===(host || null));
    if(client){await client.focus();client.postMessage({type:'rcm-notification-click',host,threadId});}
    else {const url=new URL('/',self.location.origin);if(host)url.searchParams.set('host',host);await self.clients.openWindow(url.href);}
  })());
});
