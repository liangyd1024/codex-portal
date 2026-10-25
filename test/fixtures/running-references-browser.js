// Isolated request interception. No native engine or reference tool is called.
(() => {
 const f=window.rcmFixture,caller='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002';
 const current=f.threads[0],source=f.threads[1];current.id=caller;current.name='引用引导验收';current.status={type:'active'};source.id=target;source.name='来源验收';
 f.owned=new Set([caller]);f.turns.set(caller,[{id:'running',status:'inProgress',items:[]}]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:caller}));
 const previous=window.fetch,json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname==='/api/thread-references'){f.calls.push({path:u.pathname,method:'GET',body:{}});return json({data:[source]});}
  const response=await previous(url,options);
  if(u.pathname==='/api/status'){const value=await response.json();value.service.protocolValidation.features.threadReferences={supported:true};value.service.protocolValidation.features.threadReferenceSteer={supported:true};return json(value,response.status);}
  return response;
 };
})();
