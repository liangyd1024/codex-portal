// Synthetic DOM selection probe, not a test of native mobile selection handles.
(() => {
 const f=window.rcmFixture;
 if(!f)throw Error('Selection probe requires isolated fixture');
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');
  panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;color:black;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='正文稳定性验收';panel.append(summary);
  const button=document.createElement('button');button.textContent='检查选区与流式节点';button.style.minHeight='44px';panel.append(button);
  const output=document.createElement('pre');output.setAttribute('aria-label','选区检查记录');output.style.whiteSpace='pre-wrap';panel.append(output);document.body.append(panel);
  let serial=0;
  button.onclick=()=>{
   if(button.disabled)return;button.disabled=true;
   const article=document.querySelector('article[aria-label="Codex 回复"]'),paragraph=article?.querySelector('p');
   if(!paragraph?.firstChild){output.textContent='回复尚未就绪';button.disabled=false;return;}
   const text=paragraph.firstChild,range=document.createRange(),selection=getSelection();
   range.setStart(text,0);range.setEnd(text,Math.min(8,text.textContent.length));selection.removeAllRanges();selection.addRange(range);
   const before=selection.toString(),turns=[...document.querySelectorAll('.message-turn')];
   const expanded=[...document.querySelectorAll('#messages details')];for(const item of expanded)item.open=true;
   const delta='\n\n选区稳定性验收追加 '+(++serial)+'。';
   const finish=result=>{observer.disconnect();clearTimeout(timeout);button.disabled=false;output.textContent=JSON.stringify(result,null,2);};
   const observer=new MutationObserver(()=>{
    if(!article.textContent.includes(delta.trim()))return;
    finish({before,after:selection.toString(),paragraphPreserved:paragraph.isConnected&&article.querySelector('p')===paragraph,textNodePreserved:paragraph.firstChild===text,
     turnsPreserved:turns.every(n=>n.isConnected),expandedCount:expanded.length,expandedPreserved:expanded.every(n=>n.isConnected&&n.open),errors:f.errors});
   });
   const timeout=setTimeout(()=>finish({error:'流式更新等待超时',errors:f.errors}),10000);
   observer.observe(document.querySelector('#messages'),{subtree:true,childList:true,characterData:true});
   f.turns.get('qa-a')[0].items.find(i=>i.id==='qa-agent').text+=delta;
   f.emit('item/agentMessage/delta',{threadId:'qa-a',turnId:'qa-turn',itemId:'qa-agent',delta});
  };
 });
})();
