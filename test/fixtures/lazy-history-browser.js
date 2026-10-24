// Isolated current-master lazy directory and tool acceptance. No native writes.
(()=>{
 const f=window.rcmFixture,fetchFixture=window.fetch;
 const turn=n=>({id:'lazy-turn-'+n,status:'completed',items:[{id:'lazy-user-'+n,type:'userMessage',content:[{type:'text',text:'按需提问 '+n}]},{id:'lazy-answer-'+n,type:'agentMessage',text:'完整回复 '+n}]});
 f.threads[0].name='按需加载验收';f.threads[1].name='另一验收会话';
 f.turns.set('qa-a',[turn(4)]);f.turns.get('qa-a')[0].items.push({id:'lazy-tool',type:'mcpToolCall',tool:'验收工具',server:'fixture',status:'completed',detailsDeferred:true});
 f.history.set('qa-a',[turn(3),turn(2),turn(1)]);f.historyPageSize=1;
 let toolReads=0,pending;
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname.endsWith('/turn-directory')){
   f.calls.push({path:u.pathname,query:u.search,method:'GET'});
   return json({data:u.pathname.includes('/qa-a/')?[1,2,3,4].map(turn):[]});
  }
  if(u.pathname==='/api/threads/qa-a/items/lazy-tool/detail'){
   f.calls.push({path:u.pathname,query:u.search,method:'GET'});toolReads++;
   if(toolReads===1)return json({error:{message:'模拟详情失败',code:'FIXTURE_ERROR'}},503);
   if(new URLSearchParams(location.search).has('lateTool'))await new Promise(resolve=>pending=resolve);
   return json({item:{id:'lazy-tool',type:'mcpToolCall',server:'fixture',result:{text:'工具完整原文\n保留第二行',unknown:{keep:7}}}});
  }
  return fetchFixture(url,options);
 };
 addEventListener('DOMContentLoaded',()=>{
  const controls=document.createElement('details');controls.style.cssText='position:fixed;right:4px;top:56px;z-index:100000;background:white;border:1px solid black';
  const summary=document.createElement('summary');summary.textContent='按需验收控制';controls.append(summary);
  const release=document.createElement('button');release.textContent='释放工具详情';release.onclick=()=>{pending?.();pending=null;controls.open=false;};controls.append(release);document.body.append(controls);
 });
})();
