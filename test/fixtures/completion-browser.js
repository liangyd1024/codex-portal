// Isolated completion transitions. All APIs are supplied by mobile-browser.js.
(() => {
 const f=window.rcmFixture,previous=window.fetch;
 f.threads[0].name='正在查看的会话';f.threads[1].name='任务完成提醒验收';
 f.owned.add('qa-b');f.threads[1].status={type:'active'};
 f.turns.set('qa-b',[{id:'completion-turn',status:'inProgress',items:[]}]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:'qa-a'}));
 window.fetch=async(url,options={})=>{
  const u=new URL(url,location.href);
  if(u.pathname==='/api/sidebar/activity')return new Response(JSON.stringify({accountScope:'qa-account',data:JSON.parse(u.searchParams.get('ids')).map(id=>{const turn=f.turns.get(id)?.at(-1);return {id,latestTurn:turn?{id:turn.id,status:turn.status}:undefined};})}),{headers:{'Content-Type':'application/json'}});
  return previous(url,options);
 };
 f.complete=()=>{const turn=f.turns.get('qa-b')[0];turn.status='completed';turn.items=[{id:'answer',type:'agentMessage',text:'验收任务已完成。'}];f.threads[1].status={type:'idle'};f.update();f.emit('turn/completed',{threadId:'qa-b',turn});};
})();
