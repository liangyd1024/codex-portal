import {RenderCache} from './render-cache.js';
import {reconcileMessages} from './message-dom.js';
import {annotatedText} from './response-annotations.js';
import {applySideEvent} from './shared/side-chat-events.js';
import {shouldSendOnEnter} from './input-state.js';
import {compactLayout,touchInput} from './mobile-ui.js';
export function installSideChat({api,context,renderItem,notify,selectionChanged=()=>{}}){
 const chats=new Map(),cache=new RenderCache();let selected=null,frame=null,renderedId=null,controlsKey=null;
 const panel=document.createElement('aside');panel.className='side-chat-panel';panel.hidden=true;panel.setAttribute('aria-label','侧边聊天');
 const header=document.createElement('header'),title=document.createElement('strong');title.textContent='侧边聊天';
 const button=(name,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=fn;return b;};
 const close=button('关闭',()=>{panel.hidden=true;selectionChanged();document.body.classList.remove('side-chat-open');document.getElementById('message-input').focus();});header.append(title,close);
 const output=document.createElement('div');output.className='side-chat-output';output.tabIndex=0;
 const status=document.createElement('p');status.className='side-chat-status';status.setAttribute('role','status');
 const form=document.createElement('form'),fragments=document.createElement('details'),label=document.createElement('summary'),quotes=document.createElement('div');fragments.append(label,quotes);
 const input=document.createElement('textarea');input.rows=3;input.placeholder='和 Codex 一起工作';input.setAttribute('aria-label','侧边聊天消息');
 const send=button('发送',()=>{});send.type='submit';const stop=button('停止',async()=>{const s=selected;if(!s?.id)return;try{await api('/api/threads/'+s.id+'/interrupt',{method:'POST'});}catch(e){s.error=e.message;render();}});
 const retry=button('重新读取',()=>void refresh());
 const model=document.createElement('select');model.setAttribute('aria-label','侧边聊天模型');const effort=document.createElement('select');effort.setAttribute('aria-label','侧边聊天思考档位');
 model.onchange=()=>{selected.model=model.value;selected.effort=context().models.find(m=>m.id===model.value)?.efforts[0]||'';render();};effort.onchange=()=>selected.effort=effort.value;
 const unlock=button('已核对，允许继续',()=>{selected.uncertain=false;selected.error='';render();});unlock.hidden=true;
 form.append(fragments,input,model,effort,send,stop,retry,unlock);panel.append(header,output,status,form);document.querySelector('.main-panel').append(panel);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close.click();}if(e.key==='Tab'&&compactLayout()){const nodes=[...panel.querySelectorAll('button,textarea,select,summary,[tabindex]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 const entry=button('侧边聊天',()=>{if(selected){panel.hidden=false;document.body.classList.add('side-chat-open');render();input.focus();}});entry.className='side-chat-reopen';entry.hidden=true;document.querySelector('.composer-region').prepend(entry);
 input.addEventListener('input',()=>{if(selected)selected.draft=input.value;});
 let composing=false,compositionEnded=0;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;compositionEnded=performance.now();});
 input.addEventListener('keydown',e=>{if(shouldSendOnEnter(e,{touch:touchInput(),composing,compositionEnded})){e.preventDefault();if(!send.disabled)form.requestSubmit();}if(e.key==='Escape')close.click();});
 form.onsubmit=async e=>{
  e.preventDefault();const s=selected,c=context();if(!s?.id||s.busy||s.active||s.uncertain||!input.value.trim()||!c.ready)return;
  const raw=input.value,parts=s.selections.slice();s.busy=true;s.error='';render();
  try{const d=await api('/api/threads/'+s.id+'/message',{method:'POST',body:{text:annotatedText(raw,[],parts),access:'full',model:s.model,effort:s.effort}});const observed=s.turns.find(t=>t.id===d.turn.id);if(!observed||!['completed','failed','interrupted'].includes(observed.status))applySideEvent(s.turns,'turn/started',{turn:d.turn});s.active=s.turns.find(t=>t.id===d.turn.id)?.status==='inProgress';if(s.draft===raw)s.draft='';s.selections=s.selections.filter(x=>!parts.includes(x));}
  catch(error){s.error=error.message;s.uncertain=['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(error.code)||!error.status;}
  finally{s.busy=false;if(s===selected){input.value=s.draft;render();}}
 };
 function render(){
  selectionChanged();
  const s=selected;if(!s)return;const near=output.scrollHeight-output.scrollTop-output.clientHeight<100;
  status.textContent=s.error||(s.creating?'正在打开侧边聊天…':s.active?'正在回复…':!context().ready?'连接中断，草稿已保留。':'侧边聊天是临时聊天，网页重新加载后无法继续。');
  send.disabled=!s.id||s.busy||s.active||s.uncertain||!context().ready;input.disabled=!!s.busy;stop.hidden=!s.active;retry.hidden=!s.error;
  const nextControls=JSON.stringify([s.id,s.model,s.effort,s.selections,context().models]);if(nextControls!==controlsKey){controlsKey=nextControls;model.replaceChildren(...(context().models||[]).map(m=>new Option(m.label,m.id)));model.value=s.model;effort.replaceChildren(...(context().models?.find(m=>m.id===s.model)?.efforts||[s.effort]).map(v=>new Option(({low:'低',medium:'中',high:'高',xhigh:'超高'})[v]||v,v)));effort.value=s.effort;model.disabled=effort.disabled=s.busy||s.active||s.creating;unlock.hidden=!s.uncertain;
  fragments.hidden=!s.selections.length;label.textContent=s.selections.length+' 个已选文本片段';quotes.replaceChildren();s.selections.forEach((p,i)=>{const q=document.createElement('blockquote');q.textContent=(i+1)+'. '+p.text;q.append(button('移除',()=>{s.selections.splice(i,1);render();}));quotes.append(q);});}
  if(renderedId!==s){cache.clear();renderedId=s;}const next=document.createDocumentFragment();if(!s.turns.length){const empty=document.createElement('p');empty.className='side-chat-empty';empty.textContent='侧边聊天';next.append(empty);}
  for(const turn of s.turns){for(const item of turn.items||[])next.append(cache.render(turn.id+':'+item.id,JSON.stringify(item),()=>{const node=renderItem(item,{threadId:s.id,side:true});node.dataset.messageId=item.id;return node;}));if(turn.error){const error=document.createElement('p');error.textContent=turn.error.message||String(turn.error);next.append(error);}}
  reconcileMessages(output,next);cache.bind(output);
  model.disabled=effort.disabled=!!(s.busy||s.active||s.creating);unlock.hidden=!s.uncertain;
  if(near)output.scrollTop=output.scrollHeight;
 }
 async function refresh(){const s=selected;if(!s||s.refreshing)return;if(!s.id){s.error='';s.creating=true;render();try{const d=await api('/api/threads/'+s.parent+'/side-chat',{method:'POST',body:{requestId:s.requestId,model:s.model,effort:s.effort}});s.id=d.thread.id;}catch(e){s.error=e.message;}finally{s.creating=false;if(s===selected)render();}return;}s.refreshing=true;try{s.updatedTurns=new Set();const data=await api('/api/threads/'+s.id+'/side-chat-view');const updated=s.updatedTurns;s.turns=[...data.turns.filter(t=>!updated.has(t.id)),...s.turns.filter(t=>updated.has(t.id))];if(!updated.size)s.active=data.thread.status?.type==='active';s.error=s.uncertain?'上次发送结果未确认，请核对回复后再继续。':'';}catch(e){s.error=e.message;}finally{s.refreshing=false;s.updatedTurns=null;}if(s===selected)render();}
 return {
  async open(fragment){
   const c=context();if(!c.ready){notify('连接恢复后可打开侧边聊天。',true);return;}
   let s=chats.get(c.id);if(!s){s={parent:c.id,requestId:crypto.randomUUID(),draft:'',selections:[],turns:[],model:c.model,effort:c.effort};chats.set(c.id,s);}selected=s;
   if(s.selections.length>=20){notify('每条消息最多选择 20 个文本片段。',true);return;}s.selections.push({text:fragment.text,source:fragment.source,range:fragment.range});input.value=s.draft;panel.hidden=false;entry.hidden=false;document.body.classList.add('side-chat-open');render();input.focus();
   if(s.id||s.creating)return;s.creating=true;render();
   try{const d=await api('/api/threads/'+s.parent+'/side-chat',{method:'POST',body:{requestId:s.requestId,model:s.model,effort:s.effort}});s.id=d.thread.id;}
   catch(e){s.error=e.message;notify(e.message,true);}finally{s.creating=false;if(s===selected)render();}
  },
  event(method,p){
   const s=[...chats.values()].find(s=>s.id&&(s.id===p.threadId||s.id===p.thread?.id));
   if(s){s.updatedTurns?.add(p.turnId||p.turn?.id);applySideEvent(s.turns,method,p);if(method==='turn/started')s.active=true;if(method==='turn/completed')s.active=false;if(method==='thread/status/changed')s.active=p.status?.type==='active';if(method==='error')s.error=p.error?.message||'侧边聊天发生错误。';if(s===selected&&!panel.hidden&&!frame)frame=requestAnimationFrame(()=>{frame=null;render();});}
   if(method==='manager/status'&&selected&&!panel.hidden)render();
  },
  sync(){const next=chats.get(context().id)||null;if(selected!==next){panel.hidden=true;document.body.classList.remove('side-chat-open');selected=next;input.value=selected?.draft||'';}entry.hidden=!selected;},
  fragments:()=>panel.hidden?[]:selected?.selections||[],
  reconnect(){if(selected?.id)void refresh();}
 };
}
