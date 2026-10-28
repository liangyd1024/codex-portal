// Isolated warning fixture; no request reaches a native engine.
(() => {
 const f=window.rcmFixture,previous=window.fetch;
 f.threads[0].name='接管目标核对';f.turns.set('qa-a',[]);f.owned.add('qa-b');
 f.resumeWarning='会话已连接，但原来未完成的目标未保留。请核对原入口；不会自动重建或重新执行目标。';
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:'qa-a'}));
 window.fetch=async(url,options={})=>{
  const path=new URL(url,location.href).pathname,response=await previous(url,options);
  if(path==='/api/threads/qa-a'&&response.ok){
   const detail=await response.json();detail.resumeWarning=f.resumeWarning;detail.goal=null;
   return new Response(JSON.stringify(detail),{headers:{'Content-Type':'application/json'}});
  }
  return response;
 };
})();
