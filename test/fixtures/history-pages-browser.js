// Three pages of synthetic history, returned newest page first like the native API.
(() => {
 const f=window.rcmFixture;
 if(!f)throw Error('History sample requires isolated fixture');
 f.historyPageSize=1;
 f.history.set('qa-a',[3,2,1].map(n=>({id:'qa-history-'+n,status:'completed',items:[
  {id:'qa-history-user-'+n,type:'userMessage',content:[{type:'text',text:'较早提问 '+n+'：保留顺序。'}]},
  {id:'qa-history-answer-'+n,type:'agentMessage',text:'较早回复 '+n+'：完整原文。'},
 ]})));
 // Current master reads the lightweight directory before requesting history.
 // Keep newest-first storage for pagination; the directory is chronological.
 const directoryFetch=window.fetch;
 window.fetch=(url,options={})=>{
  const request=new URL(typeof url==='string'?url:url.url,location.href);
  const match=request.pathname.match(/^\/api\/threads\/([^/]+)\/turn-directory$/);
  if(!match)return directoryFetch(url,options);
  const id=decodeURIComponent(match[1]);
  f.calls.push({path:request.pathname,query:request.search,method:options.method||'GET'});
  const data=[...(f.history.get(id)||[])].reverse().concat(f.turns.get(id)||[]).map(turn=>({
   id:turn.id,status:turn.status,items:turn.items.filter(item=>item.type==='userMessage'||item.type==='agentMessage'),
  }));
  return Promise.resolve(new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}}));
 };
 const historyMode=new URLSearchParams(location.search);
 let cursorUnavailable=historyMode.get('historyCursorPermanent')==='1';
 if(historyMode.get('historyNoInput')==='1'){
  for(const turn of [f.turns.get('qa-a')[0],f.history.get('qa-a')[0]])turn.items=turn.items.filter(item=>item.type!=='userMessage');
 }
 const touchEvents=[];
 if(historyMode.get('historyTouch')==='1')for(const type of ['pointerdown','touchstart','touchmove','touchend'])document.addEventListener(type,event=>{if(touchEvents.length<100)touchEvents.push({type,pointerType:event.pointerType||null,target:event.target.closest('button,summary')?.getAttribute('aria-label')||event.target.closest('button,summary')?.textContent||event.target.tagName});},{capture:true,passive:true});
 const anchorRecords=[],delayRecords=[];
 let touchActive=false;addEventListener('touchstart',()=>{touchActive=true;},{passive:true});addEventListener('touchend',()=>{touchActive=false;},{passive:true});
 const recordDelay=phase=>delayRecords.push({phase,turns:[...document.querySelectorAll(".message-turn")].map(n=>n.dataset.turnId),requests:f.calls.map(c=>({path:c.path,query:c.query,method:c.method}))});
 if(historyMode.get('historyAnchor')==='1'){
  const longText='完整历史正文，用于检查前插后的可见位置。\n\n'.repeat(45);
  f.turns.get('qa-a')[0].items.find(item=>item.type==='agentMessage').text+= '\n\n'+longText;
  for(const turn of f.history.get('qa-a'))turn.items[1].text+='\n\n'+longText;
  const fetchFixture=window.fetch;
  window.fetch=(url,options)=>{
   const request=new URL(typeof url==='string'?url:url.url,location.href);
   if(request.pathname!=='/api/threads/qa-a/history')return fetchFixture(url,options);
   // Release manually after scrolling, or on the next touchmove in overlap mode.
   return new Promise(resolve=>{
    const release=document.createElement('button');release.textContent='释放当前历史页';release.style.minHeight='44px';
    document.querySelector('[data-history-panel]').append(release);
    let released=false;
    const releasePage=()=>{if(released)return;released=true;release.remove();
     const scroller=document.querySelector('#messages-scroller'),viewportTop=scroller.getBoundingClientRect().top;
     const anchor=[...document.querySelectorAll('.message-turn')].find(node=>node.getBoundingClientRect().bottom>viewportTop);
     const before={touchActive,id:anchor?.dataset.turnId,offset:anchor?anchor.getBoundingClientRect().top-viewportTop:null,scrollTop:scroller.scrollTop,height:scroller.scrollHeight,text:anchor?.textContent};
     const count=document.querySelectorAll('.message-turn').length;
     const observer=new MutationObserver(()=>{
      if(document.querySelectorAll('.message-turn').length<=count)return;
      observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
       const restored=[...document.querySelectorAll('.message-turn')].find(node=>node.dataset.turnId===before.id);
       anchorRecords.push({...(historyMode.get('historyDuringTouch')==='1'?{releasedDuringTouch:before.touchActive,measuredDuringTouch:touchActive}:{}),cursor:request.searchParams.get('cursor'),id:before.id,beforeOffset:before.offset,afterOffset:restored?restored.getBoundingClientRect().top-scroller.getBoundingClientRect().top:null,beforeScrollTop:before.scrollTop,afterScrollTop:scroller.scrollTop,addedHeight:scroller.scrollHeight-before.height,sameNode:restored===anchor,textPreserved:restored?.textContent===before.text});
      }));
     });
     observer.observe(document.querySelector('#messages'),{childList:true,subtree:true});
     resolve(fetchFixture(url,options));
    };
    release.onclick=releasePage;
    if(historyMode.get('historyDuringTouch')==='1'){
     release.textContent='下一次正文滑动释放历史页';
     const onMove=event=>{if(!event.target.closest('#messages-scroller'))return;document.removeEventListener('touchmove',onMove);releasePage();};
     document.addEventListener('touchmove',onMove,{passive:true});
    }
   });
  };
 }
 if(historyMode.get('historyFailure')==='1'||historyMode.get('historyCursorChanged')==='1'||cursorUnavailable){
  const fetchFixture=window.fetch;let pages=0;
  window.fetch=(url,options)=>{
   const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
   if(path==='/api/threads/qa-a/history'&&(++pages===2||cursorUnavailable&&pages>2))f.fail=(historyMode.get('historyCursorChanged')==='1'||cursorUnavailable)?{path,status:409,code:'HISTORY_CURSOR_CHANGED',message:'Synthetic cursor expired'}:{path,status:503,message:'模拟历史分页失败，请重试。'};
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
    release.onclick=()=>{recordDelay('before-release');f.pending?.resolve();release.remove();requestAnimationFrame(()=>requestAnimationFrame(()=>recordDelay('two-frames')));setTimeout(()=>recordDelay('one-second'),1000);};
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
   originalNodePreserved:Boolean(original?.isConnected&&document.querySelector('[data-turn-id="qa-turn"]')===original),...(historyMode.get('historyAnchor')==='1'?{anchors:anchorRecords}:{}),...(historyMode.get('historyTouch')==='1'?{touchEvents}:{}),...(historyMode.get('historyDelay')==='1'?{delayRecords}:{}),errors:f.errors,
  },null,2);};
  if(historyMode.get('historyDelay')==='1'){
   const refresh=document.createElement('button');refresh.textContent='触发样本详情刷新';refresh.style.minHeight='44px';
   refresh.onclick=()=>{recordDelay('before-detail-refresh');f.emit('thread/queue/changed',{threadId:'qa-a'});setTimeout(()=>recordDelay('after-detail-refresh'),1200);};panel.append(refresh);
  }
  if(historyMode.get('historyCursorPermanent')==='1'){
   const recover=document.createElement('button');recover.textContent='恢复样本历史游标';recover.style.minHeight='44px';
   recover.onclick=()=>{cursorUnavailable=false;recover.disabled=true;};panel.append(recover);
  }
  document.body.append(panel);
 });
})();
