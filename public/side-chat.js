import {asyncQuestions} from './questions.js';
import {RenderCache} from './render-cache.js';
import {reconcileMessages} from './message-dom.js';
import {annotatedText} from './response-annotations.js';
import {applySideEvent} from './shared/side-chat-events.js';
import {shouldSendOnEnter} from './input-state.js';
import {compactLayout,touchInput,installScrollFollow} from './mobile-ui.js';
import {installAttachments} from './attachments.js';
import {installComposer,implementationText} from './composer.js';
import {timedTurnGroups} from './message-time.js';
import {createSendReceipts,sendReceiptLabels} from './connection-state.js';

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const icon=name=>{const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.classList.add('icon');const use=document.createElementNS(n.namespaceURI,'use');use.setAttribute('href','#i-'+name);n.append(use);return n;};
const stateOf=t=>t?.status?.type||t?.status;
export function installSideChat({api,context,renderItem,notify,selectionChanged=()=>{},requestsChanged=()=>{}}){
 const chats=new Map(),cache=new RenderCache(),sendReceipts=createSendReceipts();let selected=null,frame=null,renderedId=null,controlsKey=null,fragmentsKey=null,attachments,composer;
 const button=(name,fn,cls='secondary-button')=>{const b=el('button',cls,name);b.type='button';b.onclick=fn;return b;};
 const panel=el('aside','side-chat-panel');panel.hidden=true;panel.setAttribute('aria-label','侧边聊天');
 const header=el('header'),title=el('strong','','侧边聊天'),description=el('small','','临时聊天');description.title='关闭面板后暂时保留；空闲 3 小时或刷新网页后可能失效。目标模式和定时任务请在主聊天使用。';
 const close=button('关闭',()=>{composer?.dismiss();settings.open=false;panel.hidden=true;selectionChanged();document.body.classList.remove('side-chat-open');document.getElementById('message-input').focus();});header.append(title,description,close);
 const scroller=el('div','side-chat-output'),output=el('div','messages');scroller.tabIndex=0;scroller.append(output);
 const region=el('div','composer-region side-chat-composer'),status=el('p','side-chat-status');status.setAttribute('role','status');
 const requestsHost=el('div','conversation-requests');
 const form=el('form','composer'),fragments=el('details','side-chat-fragments'),label=el('summary'),quotes=el('div');fragments.append(label,quotes);
 const input=el('textarea');input.rows=1;input.placeholder='和 Codex 一起工作';input.setAttribute('aria-label','侧边聊天消息');input.setAttribute('enterkeyhint','enter');
 const bottom=el('div','composer-bottom'),settings=el('details','composer-settings'),summary=el('summary'),modelLabel=el('span','composer-model-label');summary.setAttribute('aria-label','侧边聊天模型与思考档位');summary.append(icon('mark'),modelLabel,icon('chevron'));settings.append(summary);
 const modelControls=el('div','model-controls'),model=el('select'),effort=el('select');model.setAttribute('aria-label','侧边聊天模型');effort.setAttribute('aria-label','侧边聊天思考档位');
 for(const [field,name] of [[model,'模型'],[effort,'思考档位']]){const label=el('label','select-control');label.append(el('span','sr-only',name),field);modelControls.append(label);}settings.append(modelControls);
 const send=button('',()=>{},'send-button');send.type='submit';send.append(icon('arrow'));
 const stop=button('',async()=>{const s=selected;if(!s?.id||s.stopping)return;s.stopping=true;render();try{await api('/api/threads/'+s.id+'/interrupt',{method:'POST'});}catch(e){s.error=e.message;}finally{s.stopping=false;if(s===selected)render();}},'stop-button');stop.append(icon('stop'));stop.setAttribute('aria-label','停止侧边聊天轮次');
 const sendActions=el('div','send-actions');
 sendActions.append(stop,send);bottom.append(settings,sendActions);
 const retry=button('重新读取',()=>void refresh()),unlock=button('已核对，允许继续',()=>{selected.uncertain=false;selected.error='';render();});const restart=button('开始新侧聊',()=>void restartExpired());const recovery=el('div','side-chat-recovery');recovery.append(retry,unlock,restart);
 form.append(fragments,input,bottom);region.append(status,requestsHost,recovery,form);panel.append(header,scroller,region);document.querySelector('.main-panel').append(panel);
 const follow=installScrollFollow(scroller,output);
 const localContext=()=>({id:selected?.id||selected?.requestId||'side-empty',cwd:selected?.cwd||context().cwd,ready:!!selected?.id&&context().ready&&!selected?.expired,busy:!!selected?.busy||!!selected?.creating||!!selected?.uncertain,active:!!selected?.active,turns:selected?.turns||[],ephemeral:true});
 const sideApi=(path,options)=>/^\/api\/threads\/[^/]+$/.test(path)?api(path+'/side-chat-view',options):api(path,options);
 attachments=installAttachments({host:'side-'+crypto.randomUUID(),context:localContext,changed:render,notify,form,input,prefix:'side-'});
 composer=installComposer({host:'side-'+crypto.randomUUID(),api:sideApi,context:localContext,refresh,notify,input,images:attachments.button,prefix:'side-',implementPlan:async(id,plan)=>{if(id!==selected?.id||selected.active||selected.busy||selected.uncertain||!localContext().ready||attachments.pending())throw Object.assign(Error('请先等待当前轮次完成。'),{status:409});await submit(implementationText(plan),true);}});
 const entry=button('侧边聊天',()=>{if(selected){panel.hidden=false;document.body.classList.add('side-chat-open');render();requestsChanged();input.focus();}});entry.className='side-chat-reopen';entry.hidden=true;document.querySelector('.composer-region').prepend(entry);
 const closeSettings=()=>{settings.open=false;summary.focus();};
 model.onchange=()=>{selected.model=model.value;const m=context().models.find(m=>m.id===model.value);selected.effort=m?.defaultEffort||m?.efforts[0]||'';closeSettings();render();};effort.onchange=()=>{selected.effort=effort.value;closeSettings();render();};
 document.addEventListener('pointerdown',e=>{if(!settings.contains(e.target))settings.open=false;});
 settings.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSettings();}});
 panel.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close.click();}if(e.key==='Tab'&&compactLayout()){const nodes=[...panel.querySelectorAll('button,textarea,select,summary,[tabindex]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 let sizeKey='';const resize=()=>{if(!input.clientWidth)return;const key=input.value+':'+input.clientWidth;if(key===sizeKey)return;sizeKey=key;input.style.height='auto';input.style.height=Math.min(160,input.scrollHeight)+'px';input.style.overflowY=input.scrollHeight>160?'auto':'hidden';};
 new ResizeObserver(resize).observe(input);
 input.addEventListener('input',()=>{if(selected)selected.draft=input.value;resize();renderControls();});
 let composing=false,compositionEnded=-Infinity;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;compositionEnded=performance.now();});
 input.addEventListener('keydown',e=>{if(shouldSendOnEnter(e,{touch:touchInput(),composing,compositionEnded})){e.preventDefault();if(!send.disabled)form.requestSubmit();}});
 form.onsubmit=e=>{e.preventDefault();void submit().catch(()=>{});};
 async function submit(override,plan=false){
  const s=selected,c=localContext();if(!s?.id||s.busy||s.uncertain||!c.ready||attachments.pending())return;
  const raw=override??input.value,parts=plan?[]:s.selections.slice(),pictures=plan?{items:[]}:attachments.capture();if(!raw.trim()&&!parts.length&&!pictures.items.length)return;
  const options=plan?{mode:'default',access:'full'}:composer.options();
  if(s.active&&options.threads?.length){notify('请在当前轮次结束后发送会话引用，草稿已保留。',true);return;}
  // Match the server input normalization so native echoes retire the receipt.
  const active=s.active,text=annotatedText(raw,[],parts).trim();
  const content=[...(text?[{type:'text',text}]:[]),...pictures.items.map(i=>({type:'image',url:i.url}))];
  const receipt=sendReceipts.begin(s,content,s.turns);s.busy=true;s.error='';render();
  try{
   const d=await api('/api/threads/'+s.id+(active?'/steer':'/message'),{method:'POST',body:{text,images:pictures.items.map(i=>({url:i.url})),...options,model:s.model,effort:s.effort}});
   sendReceipts.accept(receipt,d);
   if(d.turn){applySideEvent(s.turns,'turn/started',{turn:d.turn});s.active=stateOf(s.turns.find(t=>t.id===d.turn.id))==='inProgress';}
   if(!plan){if(s.draft===raw)s.draft='';attachments.acknowledge(pictures);s.selections=s.selections.filter(x=>!parts.includes(x));}
  }catch(error){sendReceipts.fail(receipt,error);s.error=error.message;s.uncertain=receipt.status==='unknown'||error.code==='RPC_TIMEOUT';throw error;}
  finally{s.busy=false;if(s===selected){input.value=s.draft;render();}}
 }
 function renderControls(){
  const s=selected;if(!s)return;const c=localContext();
  status.textContent=s.error||(s.creating?'正在打开侧边聊天，可先输入…':!c.ready?'连接中断，草稿已保留。':s.stopping?'正在停止…':s.active?'正在回复…':'');status.hidden=!status.textContent;
  // Draft editing is local; native fork readiness only gates sending.
  send.disabled=!c.ready||!(context().models||[]).some(m=>m.id===s.model&&m.efforts.includes(s.effort))||s.busy||s.uncertain||attachments?.pending()||(!input.value.trim()&&!attachments?.has()&&!s.selections.length);send.setAttribute('aria-label',s.active?'补充侧边聊天轮次':'发送侧边聊天消息');input.disabled=!!s.busy;input.placeholder=s.active?'补充要求…':'和 Codex 一起工作';stop.hidden=!s.active;stop.disabled=!!s.stopping||!c.ready;retry.hidden=!s.error||!!s.expired;unlock.hidden=!s.uncertain||!!s.expired;restart.hidden=!s.expired;restart.disabled=!context().ready||!!s.creating;recovery.hidden=retry.hidden&&unlock.hidden&&restart.hidden;
  const models=context().models||[],key=JSON.stringify([s.model,s.effort,models]);if(key!==controlsKey){controlsKey=key;model.replaceChildren(...models.map(m=>new Option(m.label,m.id)));model.value=s.model;effort.replaceChildren(...(models.find(m=>m.id===s.model)?.efforts||[s.effort]).map(v=>new Option(({low:'低',medium:'中',high:'高',xhigh:'超高'})[v]||v,v)));effort.value=s.effort;modelLabel.textContent=(models.find(m=>m.id===s.model)?.label||s.model)+' · '+(effort.selectedOptions[0]?.text||s.effort);}
  model.disabled=effort.disabled=!c.ready||!!s.busy;composer?.render();attachments?.render();
 }
 function render(){
  selectionChanged();const s=selected;if(!s)return;
  renderControls();const key=JSON.stringify([s.id,s.selections.map(p=>p.text)]);if(key!==fragmentsKey){fragmentsKey=key;fragments.hidden=!s.selections.length;label.textContent=s.selections.length+' 个已选文本片段';quotes.replaceChildren();s.selections.forEach((p,i)=>{const q=el('blockquote','',''+(i+1)+'. '+p.text);q.append(button('移除',()=>{s.selections.splice(i,1);render();}));quotes.append(q);});}
  if(renderedId!==s){cache.clear();renderedId=s;follow.reset();}const receipts=sendReceipts.view(s,s.turns),next=document.createDocumentFragment();if(!s.turns.length&&!receipts.length){const empty=el('div','side-chat-empty');empty.append(icon('chat'),el('strong','','围绕选文继续聊'),el('p','','与主聊天分开讨论，保留当前上下文。'));next.append(empty);}
  const opened=new Set([...output.querySelectorAll('details[open][data-item-id]')].map(n=>n.dataset.itemId));
  const itemNode=(item,turn)=>cache.render(turn.id+':'+item.id,JSON.stringify(item),()=>{const node=renderItem(item,{threadId:s.id,side:true,refresh:()=>{cache.clear();render();}});node.dataset.messageId=item.id;return node;});
  for(const turn of s.turns){const node=el('section','message-turn');node.dataset.turnId=turn.id;for(const group of timedTurnGroups(turn)){if(group.type==='duration'){node.append(el('div','turn-duration',group.label));}else if(group.type==='message')node.append(itemNode(group.item,turn));else{const process=el('details','activity-group process-group');process.dataset.itemId='side-process-'+turn.id+'-'+group.key;process.open=opened.has(process.dataset.itemId);const label=el('summary');label.append(icon('chevron'),el('span','',group.durationLabel||'查看过程'));const body=el('div','activity-items');group.items.forEach(item=>body.append(itemNode(item,turn)));process.append(label,body);node.append(process);}}if(turn.error)node.append(el('div','turn-error',turn.error.message||String(turn.error)));next.append(node);}
  for(const receipt of receipts){const node=cache.render('receipt:'+receipt.id,receipt.status,()=>{const node=renderItem({id:receipt.id,type:'userMessage',content:receipt.content},{threadId:s.id,side:true});node.dataset.sendReceipt=receipt.id;const status=el('div','user-message-time',sendReceiptLabels[receipt.status]);status.setAttribute('role','status');node.append(status);return node;});next.append(node);}
  reconcileMessages(output,next);cache.bind(output);follow.schedule();resize();
 }
 async function refresh(){const s=selected;if(!s||s.refreshing)return;if(!s.id){await create(s);return;}s.refreshing=true;try{s.updatedTurns=new Set();const data=await api('/api/threads/'+s.id+'/side-chat-view');const updated=s.updatedTurns;s.turns=[...data.turns.filter(t=>!updated.has(t.id)),...s.turns.filter(t=>updated.has(t.id))];if(!updated.size)s.active=data.thread.status?.type==='active';s.error=s.uncertain?'上次发送结果未确认，请核对回复后再继续。':'';}catch(e){s.error=e.message;if(e.code==='SIDE_CHAT_EXPIRED')s.expired=true;}finally{s.refreshing=false;s.updatedTurns=null;}if(s===selected)render();}
 async function restartExpired(){const old=selected;if(!old?.expired||old.creating)return;const s={parent:old.parent,cwd:old.cwd,requestId:crypto.randomUUID(),draft:old.draft,selections:old.selections.slice(),turns:[],model:old.model,effort:old.effort};attachments.moveDraft(old.id||old.requestId,s.requestId);chats.set(s.parent,s);selected=s;input.value=s.draft;render();await create(s);}
 async function create(s){if(s.id||s.creating)return;s.creating=true;s.error='';render();try{const d=await api('/api/threads/'+s.parent+'/side-chat',{method:'POST',body:{requestId:s.requestId,model:s.model,effort:s.effort}});attachments.moveDraft(s.requestId,d.thread.id);s.id=d.thread.id;s.cwd=d.thread.cwd||s.cwd;}catch(e){s.error=e.message;notify(e.message,true);}finally{s.creating=false;if(s===selected){render();requestsChanged();}}}
 return {
  requestsHost,get id(){return selected?.id;},get visibleId(){return panel.hidden||selected?.expired?null:selected?.id;},requests:()=>[...chats.values()].flatMap(s=>s.id?asyncQuestions(s.turns,s.id):[]),
  async open(fragment){const c=context();if(!c.ready){notify('连接恢复后可打开侧边聊天。',true);return;}let s=chats.get(c.id);if(!s){const m=c.models.find(m=>m.id===c.model);s={parent:c.id,cwd:c.cwd,requestId:crypto.randomUUID(),draft:'',selections:[],turns:[],model:c.model,effort:m?.efforts.includes('medium')?'medium':m?.defaultEffort||m?.efforts[0]||c.effort};chats.set(c.id,s);}selected=s;if(s.selections.length>=20){notify('每条消息最多选择 20 个文本片段。',true);return;}s.selections.push({text:fragment.text,source:fragment.source,range:fragment.range});input.value=s.draft;panel.hidden=false;entry.hidden=false;document.body.classList.add('side-chat-open');render();input.focus();await create(s);},
  event(method,p){const s=[...chats.values()].find(s=>s.id&&(s.id===p.threadId||s.id===p.thread?.id));if(s){s.updatedTurns?.add(p.turnId||p.turn?.id);applySideEvent(s.turns,method,p);if(method==='item/completed'||method==='turn/completed')requestsChanged();if(method==='turn/started')s.active=true;if(method==='turn/completed')s.active=false;if(method==='thread/status/changed')s.active=p.status?.type==='active';if(method==='thread/closed'||method==='side-chat/expired'){s.expired=true;s.active=false;s.error='临时聊天已过期，请开始新侧聊。';selectionChanged();}if(method==='error')s.error=p.error?.message||'侧边聊天发生错误。';if(s===selected&&!panel.hidden&&!frame)frame=requestAnimationFrame(()=>{frame=null;render();});}if(method==='manager/status'&&selected&&!panel.hidden)renderControls();},
  sync(){const next=chats.get(context().id)||null;if(selected!==next){composer?.dismiss();settings.open=false;panel.hidden=true;document.body.classList.remove('side-chat-open');selected=next;input.value=selected?.draft||'';requestsHost.replaceChildren();composer?.render();attachments?.render();}entry.hidden=!selected;selectionChanged();if(selected&&!panel.hidden)renderControls();},
  fragments:()=>panel.hidden?[]:selected?.selections||[],reconnect(){if(selected?.id)void refresh();}
 };
}
