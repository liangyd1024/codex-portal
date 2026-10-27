// Notification delivery and durable click intent only; no fetch interception or task execution.
const clickCache=()=>caches.open('rcm-notification-click');
const clickKey='/__notification-click';
let clickWork=Promise.resolve(), fallbackClick=null;
function serializeClick(work){const next=clickWork.then(work);clickWork=next.catch(()=>{});return next;}
// Immutable per-event keys prevent one worker's stale snapshot overwriting another.
// Only routing IDs and bounded runtime metadata are persisted; never bodies or keys.
const workerVersion=8,instanceId=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const journalName='rcm-notification-journal-v2',journalPrefix='/__notification-event/';
let sequence=0,journal=[],journalStorage='available',journalWork,journalGeneration=0,savedGeneration=0;
function bounded(promise,fallback,ms=800){
  if(typeof setTimeout!=='function')return Promise.resolve(promise).catch(()=>fallback);
  return new Promise(resolve=>{const timer=setTimeout(()=>resolve(fallback),ms);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(fallback);});});
}
function diagnosticUrl(value){try{const u=new URL(value);return u.origin+u.pathname+(u.searchParams.has('v')?'?v='+encodeURIComponent(u.searchParams.get('v')):'');}catch{return '';}}
async function diagnosticContext(){
  const context={instanceId,version:'worker-'+workerVersion,script:diagnosticUrl(self.location?.href),scope:diagnosticUrl(self.registration?.scope)};
  await Promise.all([
    bounded((async()=>{const sub=await self.registration?.pushManager?.getSubscription();if(sub){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));context.endpointHash=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}})(),undefined),
    bounded((async()=>{context.windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>{try{return new URL(c.url).origin===self.location.origin;}catch{return false;}}).length;})(),undefined),
  ]);
  return context;
}
function journalRow(value){
  if(!value||typeof value!=='object'||!Number.isSafeInteger(value.at)||value.at<0||typeof value.stage!=='string'||!/^worker-[a-z-]{1,40}$/.test(value.stage))return null;
  const row={at:value.at,stage:value.stage};
  for(const key of ['id','instanceId','version','host','threadId','clickId','testId','mode'])if(typeof value[key]==='string')row[key]=value[key].slice(0,160);
  for(const key of ['script','scope'])if(typeof value[key]==='string')row[key]=diagnosticUrl(value[key]);
  if(typeof value.endpointHash==='string'&&/^[a-f0-9]{64}$/.test(value.endpointHash))row.endpointHash=value.endpointHash;
  if(Number.isInteger(value.windows))row.windows=Math.min(100,Math.max(0,value.windows));
  if(typeof value.error==='string')row.error=value.error.replace(/https?:\/\/\S+/g,'[URL]').slice(0,240);
  return row;
}
function mergeJournal(rows){return [...new Map(rows.map(journalRow).filter(Boolean).map(row=>[row.id||JSON.stringify(row),row])).values()].sort((a,b)=>a.at-b.at||String(a.id||'').localeCompare(String(b.id||''))).slice(-32);}
async function synchronizeJournal(){
  // At most one outstanding storage job per instance, including after timeout.
  // Cache operations cannot be cancelled: expiry prevents starting further work.
  if(journalWork)return bounded(journalWork,undefined);
  if(!globalThis.navigator?.locks){journalStorage='unavailable';return;}
  let expired=false;
  const controller=new AbortController();
  const timer=setTimeout(()=>{expired=true;journalStorage='unavailable';controller.abort();},800);
  const check=()=>{if(expired)throw Error('journal deadline');};
  journalWork=navigator.locks.request(journalName,{signal:controller.signal},async()=>{
    check();const cache=await caches.open(journalName);check();
    do{
    const generation=journalGeneration;
    const keys=await cache.keys();check();
    const rows=[],entries=[];
    // Sequential, at most 32 records. A corrupt row cannot discard other evidence.
    for(const key of keys.slice(-32)){
      check();let row=null;
      try{const response=await cache.match(key);check();row=response?journalRow(await response.json()):null;}catch{}
      check();if(row){rows.push(row);entries.push({key,row});}
    }
    journal=mergeJournal([...rows,...journal]);
    const wanted=new Set(journal.filter(row=>row.id).map(row=>row.id));
    const keep=new Set(entries.filter(({row})=>wanted.has(row.id)).map(({key})=>key.url));
    let remaining=keys.length,removed=0;
    // Prune BEFORE adding keys. Failed keys/delete means no further expansion.
    // Bound cleanup work even for a pre-existing oversized or damaged cache.
    for(const key of keys){
      if(keep.has(key.url))continue;
      if(removed===32)break;
      check();if(!await cache.delete(key))throw Error('journal cleanup failed');check();
      remaining--;removed++;
    }
    const stored=new Set(entries.filter(({key})=>keep.has(key.url)).map(({row})=>row.id));
    for(const row of journal){
      if(!row.id||stored.has(row.id))continue;
      if(remaining>=32)throw Error('journal capacity unconfirmed');
      check();await cache.put(journalPrefix+String(row.at).padStart(16,'0')+'-'+row.id,new Response(JSON.stringify(row)));check();remaining++;
    }
    // Legacy storage is read-only and independently fallible.
    try{
      check();const legacyCache=await caches.open('rcm-notification-journal');check();
      const response=await legacyCache.match('/__notification-journal');check();
      const legacy=response?await response.json():[];check();
      if(Array.isArray(legacy))journal=mergeJournal([...legacy.slice(-32),...journal]);
    }catch{}
    check();journalStorage='available';savedGeneration=generation;
    }while(savedGeneration!==journalGeneration);
  }).catch(()=>{journalStorage='unavailable';}).finally(()=>{clearTimeout(timer);journalWork=undefined;});
  await bounded(journalWork,undefined);
}
async function readJournal(){await synchronizeJournal();return mergeJournal(journal);}
async function recordNavigation(stage,data={},extra={}){
  data ||= {};
  const entry={at:Date.now(),id:instanceId+'-'+String(++sequence).padStart(8,'0'),instanceId,version:'worker-'+workerVersion,stage,...extra};
  for(const key of ['host','threadId','clickId','testId'])if(typeof data[key]==='string')entry[key]=data[key].slice(0,160);
  journal=mergeJournal([...journal,entry]);const generation=++journalGeneration;
  await synchronizeJournal();
  // Cover an enqueue between the last generation check and lock release. Only
  // one follow-up, never another job while a timed-out storage call is pending.
  if(savedGeneration<generation&&journalStorage==='available'&&!journalWork)await synchronizeJournal();
  return entry;
}
let traceContext;
async function reportNavigation(stage,data={},extra={}){
  data ||= {};
  const entry=await recordNavigation(stage,data,extra);
  if(typeof fetch!=='function')return;
  try{
    traceContext ||= Promise.all([fetch('/api/csrf',{cache:'no-store',signal:AbortSignal.timeout(1500)}).then(r=>r.json()),fetch('/api/connections',{cache:'no-store',signal:AbortSignal.timeout(1500)}).then(r=>r.json())]).catch(error=>{traceContext=null;throw error;});
    const [csrf,config]=await traceContext;
    const result=await fetch('/api/push/trace?host='+encodeURIComponent(data.host||config.defaultConnection),{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.token,'X-RCM-Config-Revision':config.configRevision},body:JSON.stringify({...entry,observedAt:entry.at}),signal:AbortSignal.timeout(1500)});
    if(result.ok)return;
    traceContext=null;
  }catch{}
  try{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(item=>item.focused)||windows.find(item=>item.visibilityState==='visible');
    if(client&&new URL(client.url).origin===self.location.origin)client.postMessage({type:'rcm-navigation-trace',...entry,observedAt:entry.at});
  }catch{}
}
// Observation is independent of showing/navigating and cannot reject the push.
function observe(event,stage,data,context=diagnosticContext(),extra={}){
  event.waitUntil(bounded((async()=>{await reportNavigation(stage,data,{...await context,...extra});})(),undefined,2500));
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
  if(event.data?.type==='rcm-push-version')event.ports?.[0]?.postMessage({version:workerVersion});
  if(event.data?.type==='rcm-push-diagnostics')event.waitUntil((async()=>{
    const [journal,context]=await Promise.all([readJournal(),diagnosticContext()]);
    event.ports?.[0]?.postMessage({version:workerVersion,journal,context,capabilities:'push='+('onpush' in self)+', click='+('onnotificationclick' in self)+', storage='+journalStorage});
  })());
});
self.addEventListener('push',event=>{
  let message;try{message=event.data?.json();}catch{}
  // Only the native event.notification selects declarative semantics. Old
  // browsers can deliver web_push JSON as a legacy push with no Notification.
  const declarative=event.notification!=null;
  const notice=declarative?event.notification:message?.notification||message;
  const context=diagnosticContext(),mode=declarative?'declarative':'legacy';
  observe(event,'worker-push',notice?.data,context,{mode});
  event.waitUntil((async()=>{
    let error;
    const data=notice?.data||{},diagnostic=data.diagnostic===true&&typeof data.testId==='string';
    const title=notice?.title||'Codex · 新通知';
    const options={body:notice?.body||'打开应用查看',tag:notice?.tag,data,silent:false};
    // Notification fields may be prototype getters. WebKit requires a valid
    // navigate for declarative replacements; it handles their activation itself.
    if(declarative)options.navigate=notice.navigate;
    try{await self.registration.showNotification(diagnostic?'[接收器·'+(declarative?'系统跳转':'点击处理')+'] '+title.replace(/^\[原始(?:·[^\]]+)?\] /,''):title,options);}
    catch(caught){error=String(caught?.name||'Error')+': '+String(caught?.message||caught).replace(/https?:\/\/\S+/g,'[URL]').slice(0,200);}
    observe(event,error?'worker-show-failed':'worker-shown',data,context,{mode,...(error?{error}: {})});
    if(data.testId){
      // A hung client lookup must not turn a successfully shown notice into fallback.
      const windows=await bounded(self.clients.matchAll({type:'window',includeUncontrolled:true}),[]);
      for(const client of windows)try{client.postMessage({type:'rcm-push-receipt',testId:data.testId,error});}catch{}
    }
    if(error)throw Error(error);
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const {host,threadId}=event.notification.data || {};
  const context=diagnosticContext();
  event.waitUntil((async()=>{
    const target={type:'rcm-notification-click',host,threadId,testId:event.notification.data?.testId,clickId:crypto.randomUUID()};
    observe(event,'worker-click',target,context,{mode:'legacy'});
    // Keep storage ordering separate from window startup: the new page may ask
    // for its target before openWindow/focus resolves.
    if(threadId)await serializeClick(async()=>{
      fallbackClick=target;
      try{await (await clickCache()).put(clickKey,new Response(JSON.stringify(target)));}catch{}
    });
    const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(item=>new URL(item.url).origin===self.location.origin);
    if(threadId&&fallbackClick?.clickId!==target.clickId)return;
    observe(event,'worker-window',target,context,{mode:'legacy',windows:windows.length});
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
