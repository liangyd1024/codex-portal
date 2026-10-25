// Isolated startup acceptance only; all requests are handled by mobile-browser.js.
(()=>{
 const f=window.rcmFixture;if(!f)throw Error('Startup fixture requires the isolated API');
 const mode=new URL(location.href).searchParams.get('startupCase')||'normal';
 if(!['normal','disconnected','connecting','csrf-failed','status-failed','notification'].includes(mode))throw Error('Unknown startup case');
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:'qa-a',desktopMode:false}));
 sessionStorage.setItem('rcm.drafts.qa-local',JSON.stringify([['qa-a','启动草稿 A'],['qa-b','启动草稿 B']]));
 f.connected=!['disconnected','connecting'].includes(mode);f.startupConnecting=mode==='connecting';
 const blocked=mode==='status-failed'?'/api/status':'/api/csrf';let blockedReads=true;const waiting=[];
 f.startupGate={path:blocked,waiting:0,release(){blockedReads=false;for(const resolve of waiting)resolve();waiting.length=0;}};
 if(mode==='csrf-failed'||mode==='status-failed')f.fail={path:blocked,status:503,message:'模拟启动失败，请重试。'};
 const previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  if(path===blocked&&blockedReads){f.startupGate.waiting++;await new Promise(resolve=>waiting.push(resolve));}
  const response=await previous(url,options);
  if(path!=='/api/status'||!response.ok||!f.startupConnecting)return response;
  const data=await response.json();data.connection={...data.connection,state:'connecting',stage:'models'};
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 };
 if(mode==='notification')addEventListener('rcm-ready',()=>{
  if(!navigator.serviceWorker)throw Error('Service worker container unavailable');
  navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'rcm-notification-click',host:'qa-local',threadId:'qa-b',future:{raw:true}}}));
 },{once:true});
})();
