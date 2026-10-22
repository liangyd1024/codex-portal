// Extend mobile-browser.js; all API requests remain intercepted.
(() => {
 const f=window.rcmFixture,id=f.threads[0].id;
 f.owned.clear();f.handoffs=[{threadId:id,state:'released'}];f.referencesSupported=true;f.desktopAvailable=true;f.receipts={};
 f.threads[0].name='会话引用验收';f.threads[1].name='测试上下文';
 f.turns.set(id,[]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:id}));
 const previous=window.fetch,json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const u=new URL(url,location.href),p=u.pathname;
  if(!p.startsWith('/api/desktop/'))return previous(url,options);
  const body=options.body?JSON.parse(options.body):{};f.calls.push({path:p,method:options.method||'GET',body});
  if(f.offline)throw new TypeError('fixture offline');
  if(f.delay?.path===p){const d=f.delay;f.delay=null;await new Promise(resolve=>{d.resolve=resolve;f.pending=d;});}
  if(f.fail?.path===p){const fail=f.fail;f.fail=null;return json({error:{message:'模拟发送失败',code:fail.code||'INVALID_REQUEST'}},fail.status||400);}
  if(p==='/api/desktop/candidates')return json({data:f.threads.filter(t=>t.name.includes(u.searchParams.get('search')||''))});
  if(p.endsWith('/message')){f.receipts[body.messageId]={status:'accepted',turnId:'native-test'};return json({accepted:true,turnId:'native-test'});}
  if(p.endsWith('/acknowledge')){f.receipts={};return json({ok:true});}
  if(p.endsWith('/history'))return json({data:[],nextCursor:null});
  return json({thread:f.threads.find(t=>p.endsWith(t.id)),turns:[],controlled:false,controlState:'desktop',historySource:'snapshot',desktop:{available:f.desktopAvailable,canSend:f.desktopAvailable,threadReferencesSupported:f.referencesSupported,receipts:f.receipts,error:f.desktopAvailable?null:'请先在桌面打开此会话。'},pendingRequests:[]});
 };
})();
