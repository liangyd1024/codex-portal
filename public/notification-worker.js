// Notification delivery and durable click intent only; no fetch interception or task execution.
const clickCache=()=>caches.open('rcm-notification-click');
const clickKey='/__notification-click';
let clickWork=Promise.resolve(), fallbackClick=null;
function serializeClick(work){const next=clickWork.then(work);clickWork=next.catch(()=>{});return next;}
// Bounded diagnostics contain routing IDs only, never notification bodies or keys.
let journalWork=Promise.resolve(),journal=[],journalLoaded=false,journalStorage='available';
function withJournal(work){const next=journalWork.then(work);journalWork=next.catch(()=>{});return next;}
async function readJournal(){
  if(!journalLoaded){
    try{const saved=await (await caches.open('rcm-notification-journal')).match('/__notification-journal');if(saved)journal=(await saved.json()).slice(-32);}
    catch{journalStorage='unavailable';}
    journalLoaded=true;
  }
  return journal;
}
function recordNavigation(stage,data={},windows){return withJournal(async()=>{
  await readJournal();
  data ||= {};
  const entry={at:Date.now(),stage};
  for(const key of ['host','threadId','clickId','testId'])if(typeof data[key]==='string')entry[key]=data[key].slice(0,160);
  if(Number.isFinite(windows))entry.windows=windows;
  journal=[...journal,entry].slice(-32);
  try{await (await caches.open('rcm-notification-journal')).put('/__notification-journal',new Response(JSON.stringify(journal)));}
  catch{journalStorage='unavailable';}
});}
let traceContext;
async function reportNavigation(stage,data={},windows){
  await recordNavigation(stage,data,windows);
  if(typeof fetch!=='function')return;
  try{
    traceContext ||= Promise.all([fetch('/api/csrf',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.json()),fetch('/api/connections',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.json())]).catch(error=>{traceContext=null;throw error;});
    const [csrf,config]=await traceContext,subscription=await self.registration.pushManager.getSubscription();
    const result=await fetch('/api/push/trace?host='+encodeURIComponent(data.host||config.defaultConnection),{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.token,'X-RCM-Config-Revision':config.configRevision},body:JSON.stringify({stage,threadId:data.threadId,clickId:data.clickId,testId:data.testId,endpoint:subscription?.endpoint,version:'worker-6',windows}),signal:AbortSignal.timeout(4000)});
    if(result.ok)return;
    traceContext=null;
  }catch{}
  // iOS may expose different credentials in the worker. Relay only routing IDs
  // to an open same-origin page, which retains the normal CSRF-protected API.
  try{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>item.focused)||windows.find(item=>item.visibilityState==='visible');
    if(client&&new URL(client.url).origin===self.location.origin)client.postMessage({type:'rcm-navigation-trace',stage,threadId:data.threadId,clickId:data.clickId,testId:data.testId,version:'worker-6'});
  }catch{}
}
self.addEventListener('install',event=>event.waitUntil(Promise.all([self.skipWaiting(),recordNavigation('worker-install')])));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([self.clients.claim(),recordNavigation('worker-activate')])));
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
  if(event.data?.type==='rcm-push-version')event.ports?.[0]?.postMessage({version:6});
  if(event.data?.type==='rcm-push-diagnostics')event.waitUntil(withJournal(async()=>{
    await readJournal();
    event.ports?.[0]?.postMessage({version:6,journal,capabilities:'push='+('onpush' in self)+', click='+('onnotificationclick' in self)+', storage='+journalStorage});
  }));
});
self.addEventListener('push',event=>{
  let message;try{message=event.data?.json();}catch{}
  // Declarative mutable push supplies a Notification object and null data.
  // Legacy browsers still deliver the original JSON bytes through event.data.
  const notice=event.notification||message?.notification||message;
  event.waitUntil(reportNavigation('worker-push',notice?.data));
  event.waitUntil((async()=>{
    let error;
    // Replacement notifications use notificationclick; only the declarative fallback
    // uses navigate. Setting navigate here bypasses our durable click/ack handshake.
    try{await self.registration.showNotification(notice?.title||'Codex · 新通知',{body:notice?.body||'打开应用查看',tag:notice?.tag,data:notice?.data||{},silent:false});}
    catch(caught){error=String(caught.message||caught);}
    event.waitUntil(reportNavigation(error?'worker-show-failed':'worker-shown',notice?.data));
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
  event.waitUntil(reportNavigation('worker-click',event.notification.data));
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
    event.waitUntil(reportNavigation('worker-window',target,windows.length));
    const sameHost=item=>new URL(item.url).searchParams.get('host')===(host||null);
    const client=windows.find(item=>item.focused&&sameHost(item))||windows.find(item=>item.focused)||windows.find(item=>item.visibilityState==='visible'&&sameHost(item))||windows.find(item=>item.visibilityState==='visible')||windows.find(sameHost)||windows[0];
    const url=new URL('/index.html',self.location.origin);
    if(host)url.searchParams.set('host',host);
    if(threadId){url.searchParams.set('thread',threadId);url.searchParams.set('notification-click',target.clickId);}
    if(client){
      // Delivery must not wait for focus: iOS can leave that promise pending.
      try{
        const received=deliverTarget(client,target);
        event.waitUntil(client.focus().catch(()=>{}));
        if(await received)return;
        if(threadId&&fallbackClick?.clickId!==target.clickId)return;
        // A stale page or lost message must not silently keep the old thread.
        const navigated=await client.navigate(url.href);
        if(navigated)return;
      }catch{}
    }
    if(threadId&&fallbackClick?.clickId!==target.clickId)return;
    const opened=await self.clients.openWindow(url.href);opened?.postMessage?.(target);
  })());
});
function deliverTarget(client,target){
  // MessageChannel is available in supported browsers; keep a legacy fallback.
  if(typeof MessageChannel!=='function'){client.postMessage(target);return Promise.resolve(true);}
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
    const timer=setTimeout(()=>finish(false),1200);
    channel.port1.onmessage=event=>{if(event.data?.clickId===target.clickId)finish(true);};
    try{client.postMessage(target,[channel.port2]);}catch{finish(false);}
  });
}
