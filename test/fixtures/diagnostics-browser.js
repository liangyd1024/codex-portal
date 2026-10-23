// Isolated diagnostic data; never reads real host identity or error logs.
(() => {
 const previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const response=await previous(url,options);
  if(new URL(typeof url==='string'?url:url.url,location.href).pathname!=='/api/status'||!response.ok)return response;
  const s=await response.json();
  s.connection.stage='核验目标机器';
  s.recoveryFailures=[{threadId:'qa-missing',message:'模拟历史不可用 <tag> & 原文'}];
  Object.assign(s.service,{pid:12345,version:'fixture-old',installedVersion:'fixture-new'});
  Object.assign(s.service.protocolValidation,{version:'fixture-protocol',methods:42,cached:true});
  s.service.protocolValidation.features.queueWrite={supported:false,reason:'模拟能力未开放 <script>不应执行</script>'};
  s.errors=Array.from({length:12},(_,i)=>({time:new Date(Date.UTC(2020,0,1,0,0,i)).toISOString(),stage:'核验目标机器',message:'模拟错误 '+i+' <b>原文</b>'}));
  return new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json'}});
 };
})();
