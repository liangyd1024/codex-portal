// Isolated protocol scenarios. The base fixture intercepts every business API.
(() => {
 const f=window.rcmFixture,previous=window.fetch;
 const scenario=new URLSearchParams(location.search).get('compat')||'legacy';
 const patch=s=>{
  const v=s.service.protocolValidation;
  Object.assign(v,{status:'limited',version:'0.155.0-alpha.9.2',methods:43,methodReasons:{'thread/readState/update':'thread/readState/update 接口缺失'}});
  for(const name of ['threadReferences','threadReferenceSteer','goal','goalClear'])v.features[name]={supported:true};
  if(scenario==='optional')v.features.threadReferences={supported:false,reason:'turn/start 缺少参数：additionalContext'};
  if(scenario==='primary')v.features.message={supported:false,reason:'turn/start 接口缺失'};
  return s;
 };
 const emit=f.emit;f.emit=(method,params)=>emit(method,method==='manager/status'?patch(params):params);
 window.fetch=async(url,options={})=>{
  const result=await previous(url,options);
  if(new URL(typeof url==='string'?url:url.url,location.href).pathname!=='/api/status')return result;
  return new Response(JSON.stringify(patch(await result.json())),{status:result.status,headers:{'Content-Type':'application/json'}});
 };
})();
