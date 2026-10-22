import {userMessageContent} from './message-media.js';
import {markdown} from './message-body.js';
import {compactLayout} from './mobile-ui.js';

const clip=(text,length)=>{const chars=Array.from(String(text||''));return chars.length>length?chars.slice(0,length).join('')+'…':chars.join('');};
export function turnPreview(turn,{uncertain=false}={}) {
  const items=turn.items||[],question=items.find(i=>i.type==='userMessage'||i.type==='goalMessage');
  const input=question?.type==='goalMessage'?{text:question.objective}:userMessageContent(question?.content);
  const answer=items.find(i=>i.type==='agentMessage'&&i.phase==='final_answer'&&i.text?.trim())||items.find(i=>i.type==='agentMessage'&&i.text?.trim());
  const status=turn.status?.type||turn.status;
  const running=['inProgress','in_progress','running'].includes(status);
  return {id:turn.id,question:clip(input.text|| (input.images?.length?'图片消息':question?'用户消息':'继续执行'),180),answer:clip(answer?.text,1000),status:uncertain&&running?'状态待确认':running?'正在执行':({failed:'执行失败',interrupted:'已中断',completed:'已完成'}[status]||'状态待确认'),running:running&&!uncertain,time:turn.startedAt||turn.createdAt};
}
// Read one page at a time. A changed context or cancellation stops further requests.
export async function loadAllEarlier({context,loadEarlier,isCurrent,onProgress=()=>{},yieldPage=()=>new Promise(resolve=>setTimeout(resolve,0))}) {
  const seen=new Set();
  while(isCurrent()&&context().hasEarlier){
    const {cursor,loading}=context();
    if(loading||seen.has(cursor))return false;
    seen.add(cursor);
    if(!await loadEarlier())return false;
    if(!isCurrent())return false;
    onProgress();
    await yieldPage();
  }
  return isCurrent();
}
export function turnCountLabel({totalTurns,turns=[],hasEarlier}) {
  const total=Number.isSafeInteger(totalTurns)&&totalTurns>=0?Math.max(totalTurns,turns.length):!hasEarlier?turns.length:null;
  return total===null?'总数未知':'共 '+total+' 轮';
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
export function installTurnNavigation({scroller,content,entryHost,context,follow,loadEarlier}) {
  const rail=el('nav','turn-navigation');rail.setAttribute('aria-label','对话轮次');
  const ticks=el('div','turn-navigation-ticks'),older=el('button','turn-navigation-older','↑');older.type='button';older.setAttribute('aria-label','加载全部轮次');const count=el('div','turn-navigation-count');rail.append(count,older,ticks);document.body.append(rail);
  const preview=el('div','turn-preview');preview.hidden=true;preview.id='turn-preview';document.body.append(preview);
  const entry=el('button','turn-navigation-entry','轮次');entry.type='button';entry.setAttribute('aria-haspopup','dialog');entryHost.append(entry);
  const dialog=el('dialog','turn-directory');dialog.setAttribute('aria-label','对话轮次');
  const header=el('div','turn-directory-header'),title=el('h2','','对话轮次'),close=el('button','','关闭'),list=el('div','turn-directory-list'),more=el('button','turn-directory-more','加载更早轮次'),feedback=el('p','turn-directory-feedback');feedback.setAttribute('role','status');close.type=more.type='button';header.append(title,close);dialog.append(header,list,feedback,more);document.body.append(dialog);
  const notice=el('div','turn-navigation-notice'),noticeText=el('span'),noticeAction=el('button');noticeText.setAttribute('role','status');noticeAction.type='button';notice.append(noticeText,noticeAction);rail.append(notice);notice.hidden=true;
  let key=null,rows=[],signature='',hovered=null,hideTimer,frame,currentId,loading=false,loadVersion=0,loadMessage='';
  const buttons=new Map(),positions=new Map();let restore=null,directoryTarget=null;
  const nodes=()=>[...content.querySelectorAll('.message-turn')];
  const locate=id=>nodes().find(n=>n.dataset.turnId===id);
  const reading=()=>{const top=scroller.getBoundingClientRect().top;return nodes().find(n=>n.getBoundingClientRect().bottom>top+24);};
  function hide(){clearTimeout(hideTimer);preview.hidden=true;hovered=null;}
  function deferHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hide,180);}
  function card(row,rich=false){
    const box=el('div','turn-preview-content');box.append(el('div','turn-preview-question',row.question));
    const answer=el('div','turn-preview-answer');if(rich&&row.answer)answer.append(markdown(row.answer));else if(row.answer){const rendered=markdown(row.answer);answer.textContent=(rendered.firstElementChild?.textContent||rendered.textContent).replace(/\s+/g,' ').trim();}else answer.textContent=row.status;
    box.append(answer);const meta=el('div','turn-preview-meta',row.status);
    if(row.time){const n=Number(row.time),date=new Date(Number.isFinite(n)?(n<1e12?n*1000:n):row.time);if(!Number.isNaN(date.getTime()))meta.append(document.createTextNode(' · '+date.toLocaleString()));}
    box.append(meta);return box;
  }
  function show(row,button){
    if(compactLayout())return;clearTimeout(hideTimer);hovered=row.id;preview.replaceChildren(card(row,true));for(const n of preview.querySelectorAll('a,button,[tabindex]'))n.tabIndex=-1;preview.hidden=false;
    const r=button.getBoundingClientRect();preview.style.left=Math.min(r.right+10,innerWidth-preview.offsetWidth-12)+'px';preview.style.top=Math.max(12,Math.min(r.top-18,innerHeight-preview.offsetHeight-12))+'px';
  }
  function jump(id){
    if(!locate(id))context().reveal?.(id);
    const target=locate(id);if(!target)return;restore=null;hide();if(dialog.open){directoryTarget=target;dialog.close();}follow.pause({sticky:true});
    const top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;
    scroller.scrollTop=Math.max(0,top);target.tabIndex=-1;target.focus({preventScroll:true});schedule();
  }
  function renderList(){
    const top=list.scrollTop,focused=document.activeElement?.dataset.turnTarget,bounds=list.getBoundingClientRect();
    const first=[...list.children].find(n=>n.getBoundingClientRect().bottom>bounds.top),anchor=first?{id:first.dataset.turnTarget,offset:first.getBoundingClientRect().top-bounds.top}:null;list.replaceChildren();
    for(const row of rows){const button=el('button','turn-directory-row');button.type='button';button.dataset.turnTarget=row.id;button.setAttribute('aria-label','跳转到：'+row.question);button.append(card(row));button.onclick=()=>navigate(row.id);if(row.id===currentId)button.setAttribute('aria-current','location');list.append(button);}
    list.scrollTop=top;if(anchor){const node=list.querySelector('[data-turn-target="'+CSS.escape(anchor.id)+'"]');if(node)list.scrollTop+=node.getBoundingClientRect().top-list.getBoundingClientRect().top-anchor.offset;}if(focused)list.querySelector('[data-turn-target="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
  }
  function report(message){loadMessage=message;feedback.textContent=message;noticeText.textContent=message;syncLoad();}
  async function earlier(){
    if(loading||!context().hasEarlier)return;
    const version=++loadVersion,started=key,isCurrent=()=>started===key&&version===loadVersion;
    loading=true;follow.pause({sticky:true});
    const progress=()=>report('正在加载全部轮次 · 已加载 '+context().turns.length+' 轮');
    progress();
    try{
      const loaded=await loadAllEarlier({context,loadEarlier,isCurrent,onProgress:progress});
      if(isCurrent())report(loaded?'':'加载未完成，请重试。');
    }catch{if(isCurrent())report('加载失败，请重试。');}
    finally{if(isCurrent()){loading=false;syncLoad();update();}}
  }
  function syncLoad(){
    const c=context();if(!c.hasEarlier&&!loading){loadMessage='';feedback.textContent='';noticeText.textContent='';}older.hidden=more.hidden=!c.hasEarlier;older.disabled=loading||c.loading;more.disabled=!loading&&c.loading;
    older.title=loading?'正在加载全部轮次…':'加载全部轮次';
    more.textContent=loading?'取消加载':loadMessage?'继续加载全部轮次':'加载全部轮次';
    rail.setAttribute('aria-busy',String(loading));notice.hidden=!loadMessage||dialog.open;
    noticeAction.textContent=loading?'取消':'重试';noticeAction.disabled=!loading&&c.loading;
    noticeAction.setAttribute('aria-label',loading?'取消加载全部轮次':'重试加载全部轮次');
  }
  function cancel(){loadVersion++;loading=false;report('已取消继续加载。');}
  noticeAction.onclick=()=>loading?cancel():earlier();
  older.onclick=earlier;more.onclick=()=>loading?cancel():earlier();
  function navigate(id){jump(id);void earlier();}
  entry.onclick=()=>{hide();renderList();dialog.showModal();const active=list.querySelector('[aria-current]');if(active)list.scrollTop=active.offsetTop-list.offsetTop-Math.max(0,(list.clientHeight-active.offsetHeight)/2);close.focus();void earlier();syncLoad();};close.onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{syncLoad();const target=directoryTarget;directoryTarget=null;if(target?.isConnected)target.focus({preventScroll:true});else(entry.checkVisibility()?entry:document.querySelector('#mobile-more>summary'))?.focus({preventScroll:true});});
  preview.addEventListener('pointerenter',()=>clearTimeout(hideTimer));preview.addEventListener('pointerleave',deferHide);
  document.addEventListener('pointerdown',e=>{if(!rail.contains(e.target)&&!preview.contains(e.target))hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!preview.hidden){hide();e.preventDefault();}});
  rail.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const entries=[...ticks.children],index=entries.indexOf(document.activeElement);if(index<0)return;e.preventDefault();entries[e.key==='Home'?0:e.key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();});
  function measure(){
    frame=null;const c=context(),r=scroller.getBoundingClientRect();const visible=c.visible&&rows.length>0&&r.height>0;
    rail.hidden=!visible||compactLayout();entry.hidden=!visible;
    document.querySelector('.main-panel').classList.toggle('has-turn-navigation',visible);
    rail.style.left=(r.left+4)+'px';rail.style.top=(r.top+12)+'px';rail.style.height=Math.max(0,r.height-24)+'px';
    const active=reading();currentId=active?.dataset.turnId;
    for(const [id,button] of buttons){if(id===currentId)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');}
    if(!restore&&key&&active)positions.set(key,{id:currentId,offset:active.getBoundingClientRect().top-r.top,following:follow.following});
    if(positions.size>50)positions.delete(positions.keys().next().value);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  function switchContext(next){
    if(next===key)return;key=next;restore=positions.get(next)||null;signature='';hide();if(dialog.open)dialog.close();loadVersion++;loading=false;loadMessage='';feedback.textContent='';noticeText.textContent='';notice.hidden=true;
  }
  function update(){
    const c=context();const next=c.turns.map(t=>turnPreview(t,{uncertain:c.uncertain})),sig=JSON.stringify(next);
    rows=next;
    const label=turnCountLabel(c);count.textContent=label;count.title=label;entry.textContent='轮次 · '+label;title.textContent='对话轮次 · '+label;
    if(sig!==signature){signature=sig;const keep=new Set(rows.map(r=>r.id));for(const [id,b] of buttons)if(!keep.has(id)){b.remove();buttons.delete(id);}
      rows.forEach((row,index)=>{let b=buttons.get(row.id);if(!b){b=el('button','turn-tick');b.type='button';b.append(el('span'));buttons.set(row.id,b);}b.setAttribute('aria-label','预览并跳转到：'+row.question);b.setAttribute('aria-describedby','turn-preview');b.classList.toggle('turn-tick-running',row.running);b.onclick=()=>navigate(row.id);b.onpointerenter=()=>show(row,b);b.onpointerleave=deferHide;b.onfocus=()=>show(row,b);b.onblur=deferHide;if(ticks.children[index]!==b)ticks.insertBefore(b,ticks.children[index]||null);});
      if(dialog.open)renderList();if(hovered){const row=rows.find(r=>r.id===hovered);if(row)show(row,buttons.get(row.id));else hide();}
    }
    if(restore&&rows.length){const target=locate(restore.id);if(restore.following){follow.reset();restore=null;}else if(target){follow.pause({sticky:true});scroller.scrollTop+=target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-restore.offset;restore=null;}else if(!c.hasEarlier&&!c.rendering){restore=null;}}
    syncLoad();schedule();
  }
  for(const event of ['wheel','touchstart','keydown'])scroller.addEventListener(event,()=>{restore=null;},{passive:true});
  ticks.addEventListener('scroll',hide,{passive:true});
  scroller.addEventListener('scroll',()=>{hide();schedule();},{passive:true});window.addEventListener('resize',()=>{hide();schedule();});new ResizeObserver(schedule).observe(scroller);
  return {update,switchContext};
}
