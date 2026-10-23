// Three pages of synthetic history, returned newest page first like the native API.
(() => {
 const f=window.rcmFixture;
 if(!f)throw Error('History sample requires isolated fixture');
 f.historyPageSize=1;
 f.history.set('qa-a',[3,2,1].map(n=>({id:'qa-history-'+n,status:'completed',items:[
  {id:'qa-history-user-'+n,type:'userMessage',content:[{type:'text',text:'较早提问 '+n+'：保留顺序。'}]},
  {id:'qa-history-answer-'+n,type:'agentMessage',text:'较早回复 '+n+'：完整原文。'},
 ]})));
 const historyMode=new URLSearchParams(location.search);
 if(historyMode.get('historyFailure')==='1'||historyMode.get('historyCursorChanged')==='1'){
  const fetchFixture=window.fetch;let pages=0;
  window.fetch=(url,options)=>{
   const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
   if(path==='/api/threads/qa-a/history'&&++pages===2)f.fail=historyMode.get('historyCursorChanged')==='1'?{path,status:409,code:'HISTORY_CURSOR_CHANGED',message:'Synthetic cursor expired'}:{path,status:503,message:'模拟历史分页失败，请重试。'};
   return fetchFixture(url,options);
  };
 }
 if(new URLSearchParams(location.search).get('historyDelay')==='1'){
  const fetchFixture=window.fetch;let pages=0;
  window.fetch=(url,options)=>{
   const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
   if(path==='/api/threads/qa-a/history'&&++pages===2){
    f.delay={path,ignoreAbort:true};
    const release=document.createElement('button');release.textContent='释放验收历史响应';release.style.minHeight='44px';
    release.onclick=()=>{f.pending?.resolve();release.remove();};
    (document.querySelector('dialog[aria-label="对话轮次"][open]')||document.querySelector('[data-history-panel]')).append(release);
   }
   return fetchFixture(url,options);
  };
 }
 let original;
 const capture=new MutationObserver(()=>{original=document.querySelector('[data-turn-id="qa-turn"]');if(original)capture.disconnect();});
 addEventListener('DOMContentLoaded',()=>{
  capture.observe(document.body,{childList:true,subtree:true});
  const panel=document.createElement('details');panel.dataset.historyPanel='';panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;color:black;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='连续历史验收';panel.append(summary);
  const button=document.createElement('button');button.textContent='读取历史检查记录';button.style.minHeight='44px';panel.append(button);
  const output=document.createElement('pre');output.setAttribute('aria-label','历史检查记录');output.style.whiteSpace='pre-wrap';panel.append(output);
  button.onclick=()=>{output.textContent=JSON.stringify({
   requests:f.calls.filter(c=>c.path.endsWith('/history')),turns:[...document.querySelectorAll('.message-turn')].map(n=>n.dataset.turnId),
   originalNodePreserved:Boolean(original?.isConnected&&document.querySelector('[data-turn-id="qa-turn"]')===original),errors:f.errors,
  },null,2);};document.body.append(panel);
 });
})();
