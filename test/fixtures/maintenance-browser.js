// This fixture always rejects service maintenance, without reaching any engine.
(() => {
 const f=window.rcmFixture,previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname==='/api/service/release'){
   f.calls.push({path:u.pathname,query:u.search,method:options.method||'GET',body:options.body?JSON.parse(options.body):{}});
   return new Response(JSON.stringify({error:{message:'专用服务仍有任务。请先结束这些任务，再切回桌面。',code:'SERVICE_BUSY',details:[{threadId:'qa-a',reason:'模拟任务仍在运行'}]}}),{status:409,headers:{'Content-Type':'application/json'}});
  }
  return previous(url,options);
 };
})();
