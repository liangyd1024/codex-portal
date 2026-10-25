// Isolated directory reads and history failures. No native service is accessed.
(()=>{
 const f=window.rcmFixture,previous=window.fetch;
 const turn=n=>({id:'directory-turn-'+n,status:'completed',items:[{id:'directory-user-'+n,type:'userMessage',content:[{type:'text',text:'目录问题 '+n}]},{id:'directory-answer-'+n,type:'agentMessage',phase:'final_answer',text:'完整目录回复 '+n+'\n\n保留原文、标点与换行。'}]});
 f.threads[0].name='轮次目录测试';f.threads[1].name='目录切换目标';f.owned.add('qa-b');
 f.turns.set('qa-a',[turn(4)]);f.turns.set('qa-b',[turn(99)]);
 f.history.set('qa-a',[turn(3),turn(2),turn(1)]);f.historyPageSize=1;
 const mode=new URL(location.href).searchParams.get('directoryCase')||'normal';let first=true;
 f.directoryChecks={reads:[],historyReleased:false,historyConsumed:[]};
 window.fetch=async(url,options={})=>{
  const u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname.endsWith('/history')){const response=await previous(url,options),read=response.text.bind(response);response.text=async()=>{const body=await read();f.directoryChecks.historyConsumed.push({path:u.pathname,query:u.search,status:response.status});return body;};return response;}
  if(!u.pathname.endsWith('/turn-directory'))return previous(url,options);
  f.calls.push({path:u.pathname,query:u.search,method:'GET'});f.directoryChecks.reads.push(u.pathname);
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(first&&u.pathname.includes('/qa-a/')){first=false;if(mode==='failure')return reply({error:{message:'模拟目录读取失败',code:'FIXTURE_ERROR'}},503);if(mode==='invalid')return reply({data:null});}
  return reply({data:u.pathname.includes('/qa-a/')?[1,2,3,4].map(turn):[turn(99)]});
 };
 addEventListener('rcm-ready',()=>{
  const panel=document.createElement('details');panel.id='directory-test-controls';panel.style.cssText='position:fixed;right:4px;top:56px;z-index:100000;background:white;border:1px solid black';
  const summary=document.createElement('summary');summary.textContent='目录验收控制';panel.append(summary);
  const button=(name,run)=>{const b=document.createElement('button');b.textContent=name;b.style.cssText='display:block;min-height:44px';b.onclick=()=>{run();panel.open=false;};panel.append(b);};
  button('下次历史失败',()=>{f.fail={path:'/api/threads/qa-a/history',status:503,message:'模拟历史读取失败'};});
  button('延迟下次历史',()=>{f.delay={path:'/api/threads/qa-a/history',ignoreAbort:true};});
  button('释放迟到历史',()=>{if(f.pending?.path!=='/api/threads/qa-a/history')throw Error('No pending directory history');f.pending.resolve();f.pending=null;f.directoryChecks.historyReleased=true;});
  document.body.append(panel);
 });
})();
