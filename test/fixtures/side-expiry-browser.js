// Isolated native-event sample. No real engine mutations.
(()=>{
 const f=window.rcmFixture;f.sideExpiry=true;f.sideSerial=0;
 const receiptMode=new URLSearchParams(location.search).get('sideReceipt')==='1';
 let pendingSend,serial=0;
 if(receiptMode){
  const fetchFixture=window.fetch;
  window.fetch=(url,options={})=>{
   const u=new URL(typeof url==='string'?url:url.url,location.href);
   const match=u.pathname.match(/^\/api\/threads\/(qa-side-\d+)\/(message|steer)$/);
   if(!match)return fetchFixture(url,options);
   const body=JSON.parse(options.body);f.calls.push({path:u.pathname,query:u.search,method:options.method,body});
   const id='receipt-turn-'+(++serial),content=[{type:'text',text:body.text.trim()}];
   return new Promise(resolve=>{pendingSend={id,threadId:match[1],content,httpDone:false,nativeDone:false,
    http(){if(this.httpDone)return;this.httpDone=true;resolve({ok:true,status:200,text:async()=>JSON.stringify({turn:{id,status:'inProgress',items:[]}})});},
    native(){if(this.nativeDone)return;this.nativeDone=true;const turn={id,status:'completed',items:[{id:id+'-user',type:'userMessage',content},{id:id+'-reply',type:'agentMessage',text:'模拟原生回复：完整保留。'}]};
     f.turns.set(this.threadId,[...(f.turns.get(this.threadId)||[]),turn]);
     for(const item of turn.items)f.emit('item/completed',{threadId:this.threadId,turnId:id,item});
     f.emit('turn/completed',{threadId:this.threadId,turn});
    }};});
  };
 }
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='侧聊到期验收';panel.append(summary);
  const out=document.createElement('pre');out.setAttribute('aria-label','侧聊验收记录');out.style.whiteSpace='pre-wrap';
  const button=(text,run)=>{const b=document.createElement('button');b.textContent=text;b.style.minHeight='44px';b.onclick=run;panel.append(b);};
  button('选中样本正文',()=>{panel.open=false;const p=document.querySelector('article[aria-label="Codex 回复"] p');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  button('下次重建失败',()=>{f.fail={path:'/api/threads/qa-a/side-chat',status:503,message:'模拟重建失败'};panel.open=false;});
  button('模拟侧聊到期',()=>{panel.open=false;f.emit('side-chat/expired',{threadId:'qa-side-'+f.sideSerial});});
  button('读取侧聊记录',()=>{out.textContent=JSON.stringify({creates:f.calls.filter(c=>c.path.endsWith('/side-chat')),views:f.calls.filter(c=>c.path==='/api/thread-view').map(c=>c.body.sideThreadId),errors:f.errors},null,2);});
  if(receiptMode){
   button('释放发送确认',()=>pendingSend?.http());
   button('释放原生输入与回复',()=>pendingSend?.native());
   button('读取发送回执记录',()=>{const side=document.querySelector('.side-chat-panel');out.textContent=JSON.stringify({
    sends:f.calls.filter(c=>/\/(message|steer)$/.test(c.path)),receipts:side.querySelectorAll('[data-send-receipt]').length,
    output:side.querySelector('.side-chat-output').textContent,draft:side.querySelector('textarea').value,
    httpDone:pendingSend?.httpDone,nativeDone:pendingSend?.nativeDone,errors:f.errors,
   },null,2);});
  }
  panel.append(out);document.body.append(panel);
 });
})();
