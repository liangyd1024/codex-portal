// Isolated native-event sample. No real engine mutations.
(()=>{
 const f=window.rcmFixture;f.sideExpiry=true;f.sideSerial=0;
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='侧聊到期验收';panel.append(summary);
  const out=document.createElement('pre');out.setAttribute('aria-label','侧聊验收记录');out.style.whiteSpace='pre-wrap';
  const button=(text,run)=>{const b=document.createElement('button');b.textContent=text;b.style.minHeight='44px';b.onclick=run;panel.append(b);};
  button('选中样本正文',()=>{panel.open=false;const p=document.querySelector('article[aria-label="Codex 回复"] p');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  button('模拟侧聊到期',()=>{panel.open=false;f.emit('side-chat/expired',{threadId:'qa-side-'+f.sideSerial});});
  button('读取侧聊记录',()=>{out.textContent=JSON.stringify({creates:f.calls.filter(c=>c.path.endsWith('/side-chat')),views:f.calls.filter(c=>c.path==='/api/thread-view').map(c=>c.body.sideThreadId),errors:f.errors},null,2);});
  panel.append(out);document.body.append(panel);
 });
})();
