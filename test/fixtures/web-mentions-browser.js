// Extend mobile-browser.js with UUID identifiers. All API calls remain intercepted.
(() => {
 const f=window.rcmFixture,id=f.threads[0].id;
 f.threads[0].name='网页引用验收';f.threads[1].name='网页来源会话';
 f.threads.push({...f.threads[1],id:'00000000-0000-4000-8000-000000000003',name:'桌面来源会话'});
 f.turns.set(id,[]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:id}));
 const previous=window.fetch,json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const u=new URL(url,location.href),p=u.pathname;
  if(p!=='/api/thread-references')return previous(url,options);
  f.calls.push({path:p,query:u.search,method:'GET',body:{}});
  if(f.offline)throw new TypeError('fixture offline');
  if(f.delay?.path===p){const d=f.delay;f.delay=null;await new Promise(resolve=>{d.resolve=resolve;f.pending=d;});}
  if(f.fail?.path===p){f.fail=null;return json({error:{message:'模拟会话读取失败',code:'FIXTURE_ERROR'}},503);}
  return json({data:f.threads.filter(t=>t.name.includes(u.searchParams.get('search')||''))});
 };
})();
