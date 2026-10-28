import type {EventParams} from './events';
import type {ApiOptions,ApiError} from './api';
export interface SideItem {id:string;type:string;[field:string]:unknown}
export interface SideTurn {id:string;status?:string|{type?:string};items:SideItem[];error?:{message?:string};[field:string]:unknown}
export interface SideFragment {text:string;source?:unknown;range?:Range}
export interface SideModel {id:string;label:string;efforts:string[];defaultEffort?:string;[field:string]:unknown}
export interface SideState {parent:string|null;cwd:string|undefined;requestId:string;draft:string;selections:SideFragment[];turns:SideTurn[];model:string;effort:string;id?:string;error?:string;busy?:boolean;active?:boolean;stopping?:boolean;creating?:boolean;uncertain?:boolean;expired?:boolean;refreshing?:boolean;updatedTurns?:Set<string>|null}
export interface SideResponse {thread:{id:string;cwd?:string;status?:{type?:string};[field:string]:unknown};turns:SideTurn[];turn?:SideTurn;[field:string]:unknown}
export interface SideOptions {api:<T=SideResponse>(path:string,options?:ApiOptions)=>Promise<T>;context:()=>{id:string|null;cwd:string|undefined;ready:boolean;models:SideModel[];model:string;effort:string};renderItem:(item:SideItem|{id:string;type:string;content:unknown},options:{threadId?:string;side:boolean;refresh?:()=>void})=>HTMLElement;notify:(message:string,error?:boolean)=>unknown;selectionChanged?:()=>void;requestsChanged?:()=>void}
interface SideEvent {threadId?:string;thread?:{id?:string};turnId?:string;turn?:SideTurn;status?:{type?:string};error?:{message?:string};[field:string]:unknown}
import {installSideChatView} from '../components/SideChat';
import {clearRequestCards} from '../components/RequestCards';
import {asyncQuestions} from '../../../public/questions.js';
import {RenderCache} from '../../../public/render-cache.js';
import {reconcileMessages} from '../../../public/message-dom.js';
import {annotatedText} from '../../../public/response-annotations.js';
import {applySideEvent} from '../../../shared/side-chat-events.js';
import {shouldSendOnEnter} from '../../../public/input-state.js';
import {compactLayout,touchInput,installScrollFollow} from '../../../public/mobile-ui.js';
import {installAttachments} from '../../../public/attachments.js';
import {installComposer,implementationText} from '../../../public/composer.js';
import {installDrawerGestures} from './drawer-gestures';
import {renderProcessGroup} from '../../../public/process-summary.js';
import {timedTurnGroups} from '../../../public/message-time.js';
import {createSendReceipts,sendReceiptLabels} from '../../../public/connection-state.js';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const icon=(name:string)=>{const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.classList.add('icon');const use=document.createElementNS(n.namespaceURI,'use');use.setAttribute('href','#i-'+name);n.append(use);return n;};
const stateOf=(t:SideTurn|undefined)=>(t?.status as {type?:string}|undefined)?.type||t?.status;
export function installSideChat({api,context,renderItem,notify,selectionChanged=()=>{},requestsChanged=()=>{}}:SideOptions){
 const chats=new Map<string|null,SideState>(),cache=new RenderCache(),sendReceipts=createSendReceipts();let selected:SideState|null=null,frame:number|null=null,renderedId:SideState|null=null,fragmentsKey:string|null=null,attachments:ReturnType<typeof installAttachments>,composer:ReturnType<typeof installComposer>;
 const view=installSideChatView({
  close:()=>{composer?.dismiss();settings.open=false;view.setVisible(false);selectionChanged();document.body.classList.remove('side-chat-open');document.getElementById('message-input')!.focus();},
  stop:async()=>{const s=selected;if(!s?.id||s.stopping)return;s.stopping=true;render();try{await api('/api/threads/'+s.id+'/interrupt',{method:'POST'});}catch(e){s.error=(e as ApiError).message;}finally{s.stopping=false;if(s===selected)render();}},
  retry:()=>void refresh(),unlock:()=>{selected!.uncertain=false;selected!.error='';render();},restart:()=>void restartExpired(),
  reopen:()=>{if(selected){view.setVisible(true);document.body.classList.add('side-chat-open');render();requestsChanged();input.focus();}},
  model:()=>{selected!.model=model.value;const m=context().models.find(m=>m.id===model.value);selected!.effort=m?.defaultEffort||m?.efforts[0]||'';closeSettings();render();},
  effort:()=>{selected!.effort=effort.value;closeSettings();render();}
 });
 const {panel,close,scroller,output,requestsHost,form,input,settings,summary,model,effort,send}=view;
 const follow=installScrollFollow(scroller,output);
 installDrawerGestures({surface:panel,mode:()=>compactLayout()&&!panel.hidden?'sideChat':null,openSidebar:()=>{},closeDrawers:()=>close.click()});
 const localContext=()=>({id:selected?.id||selected?.requestId||'side-empty',cwd:selected?.cwd||context().cwd,ready:!!selected?.id&&context().ready&&!selected?.expired,busy:!!selected?.busy||!!selected?.creating||!!selected?.uncertain,active:!!selected?.active,turns:selected?.turns||[],ephemeral:true});
 const sideApi=<T=SideResponse>(path:string,options?:ApiOptions):Promise<T>=>/^\/api\/threads\/[^/]+$/.test(path)?api<T>(path+'/side-chat-view',options):api<T>(path,options);
 attachments=installAttachments({host:'side-'+crypto.randomUUID(),context:localContext,changed:render,notify,form,input,prefix:'side-'});
 composer=installComposer({host:'side-'+crypto.randomUUID(),api:sideApi,context:localContext,refresh,notify,input,images:attachments.images,prefix:'side-',implementPlan:async(id:string,plan:{text:string})=>{if(id!==selected?.id||selected!.active||selected!.busy||selected!.uncertain||!localContext().ready||attachments.pending())throw Object.assign(Error('请先等待当前轮次完成。'),{status:409});await submit(implementationText(plan),true);}});
 const closeSettings=()=>{settings.open=false;summary.focus();};
 document.addEventListener('pointerdown',e=>{if(!settings.contains(e.target as Node))settings.open=false;});
 settings.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSettings();}});
 panel.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close.click();}if(e.key==='Tab'&&compactLayout()){const nodes=[...panel.querySelectorAll<HTMLElement & {disabled?:boolean}>('button,textarea,select,summary,[tabindex]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 let sizeKey='';const resize=()=>{if(!input.clientWidth)return;const key=input.value+':'+input.clientWidth;if(key===sizeKey)return;sizeKey=key;input.style.height='auto';input.style.height=Math.min(160,input.scrollHeight)+'px';input.style.overflowY=input.scrollHeight>160?'auto':'hidden';};
 new ResizeObserver(resize).observe(input);
 input.addEventListener('input',()=>{if(selected)selected.draft=input.value;resize();renderControls();});
 let composing=false,compositionEnded=-Infinity;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;compositionEnded=performance.now();});
 input.addEventListener('keydown',e=>{if(shouldSendOnEnter(e,{touch:touchInput(),composing,compositionEnded})){e.preventDefault();if(!send.disabled)form.requestSubmit();}});
 form.onsubmit=e=>{e.preventDefault();void submit().catch(()=>{});};
 async function submit(override?:string,plan=false){
  const s=selected,c=localContext();if(!s?.id||s.busy||s.uncertain||!c.ready||attachments.pending())return;
  const raw=override??input.value,parts=plan?[]:s.selections.slice(),pictures=plan?{items:[]}:attachments.capture();if(!raw.trim()&&!parts.length&&!pictures.items.length)return;
  const options:{mode?:string;access:string;threads?:unknown[]}=plan?{mode:'default',access:'full'}:composer.options();
  if(s.active&&options.threads?.length){notify('请在当前轮次结束后发送会话引用，草稿已保留。',true);return;}
  // Match the server input normalization so native echoes retire the receipt.
  const active=s.active,text=annotatedText(raw,[],parts).trim();
  const content=[...(text?[{type:'text',text}]:[]),...pictures.items.map(i=>({type:'image',url:i.url}))];
  const receipt=sendReceipts.begin(s,content,s.turns);s.busy=true;s.error='';render();
  try{
   const d=await api('/api/threads/'+s.id+(active?'/steer':'/message'),{method:'POST',body:{text,images:pictures.items.map(i=>({url:i.url})),...options,model:s.model,effort:s.effort}});
   sendReceipts.accept(receipt,d);
   if(d.turn){applySideEvent(s.turns,'turn/started',{turn:d.turn});s.active=stateOf(s.turns.find(t=>t.id===d.turn!.id))==='inProgress';}
   if(!plan){if(s.draft===raw)s.draft='';attachments.acknowledge(pictures as ReturnType<typeof attachments.capture>);s.selections=s.selections.filter(x=>!parts.includes(x));}
  }catch(error){sendReceipts.fail(receipt,error);s.error=(error as ApiError).message;s.uncertain=receipt.status==='unknown'||(error as ApiError).code==='RPC_TIMEOUT';throw error;}
  finally{s.busy=false;if(s===selected){input.value=s.draft;render();}}
 }
 function renderControls(){
  const s=selected;if(!s)return;const c=localContext();
  view.renderControls({status:s.error||(s.creating?'正在打开侧边聊天，可先输入…':!c.ready?'连接中断，草稿已保留。':s.stopping?'正在停止…':s.active?'正在回复…':''),
   sendDisabled:!c.ready||!(context().models||[]).some(m=>m.id===s.model&&m.efforts.includes(s.effort))||s.busy||s.uncertain||attachments?.pending()||(!input.value.trim()&&!attachments?.has()&&!s.selections.length),sendLabel:s.active?'补充侧边聊天轮次':'发送侧边聊天消息',inputDisabled:!!s.busy,placeholder:s.active?'补充要求…':'和 Codex 一起工作',stopHidden:!s.active,stopDisabled:!!s.stopping||!c.ready,retryHidden:!s.error||!!s.expired,unlockHidden:!s.uncertain||!!s.expired,restartHidden:!s.expired,restartDisabled:!context().ready||!!s.creating,models:context().models||[],model:s.model,effort:s.effort,modelDisabled:!c.ready||!!s.busy});
  composer?.render();attachments?.render();
 }
 function render(){
  selectionChanged();const s=selected;if(!s)return;
  renderControls();const key=JSON.stringify([s.id,s.selections.map(p=>p.text)]);if(key!==fragmentsKey){fragmentsKey=key;view.renderFragments(s.selections.map(p=>p.text),i=>{s.selections.splice(i,1);render();});}
  if(renderedId!==s){cache.clear();renderedId=s;follow.reset();}const receipts=sendReceipts.view(s,s.turns),next=document.createDocumentFragment();if(!s.turns.length&&!receipts.length){const empty=el('div','side-chat-empty');empty.append(icon('chat'),el('strong','','围绕选文继续聊'),el('p','','与主聊天分开讨论，保留当前上下文。'));next.append(empty);}
  const opened=new Set([...output.querySelectorAll<HTMLDetailsElement>('details[open][data-item-id]')].map(n=>n.dataset.itemId));
  const itemNode=(item:SideItem,turn:SideTurn)=>cache.render(turn.id+':'+item.id,JSON.stringify(item),()=>{const node=renderItem(item,{threadId:s.id,side:true,refresh:()=>{cache.clear();render();}});node.dataset.messageId=item.id;return node;});
  for(const turn of s.turns){
   const node=el('section','message-turn');node.dataset.turnId=turn.id;
   for(const group of timedTurnGroups(turn) as ({type:'duration';label:string}|{type:'message';item:SideItem}|{type:'process';key:string;durationLabel?:string;items:SideItem[]})[]){
    if(group.type==='duration')node.append(el('div','turn-duration',group.label));
    else if(group.type==='message')node.append(itemNode(group.item,turn));
    else{
     const itemId='side-process-'+turn.id+'-'+group.key;
     const process=renderProcessGroup(turn,group,{icon,renderItem:(item:SideItem)=>itemNode(item,turn),itemId,open:opened.has(itemId),uncertain:!context().ready||!!s.expired});
     if(process)node.append(process);
    }
   }
   if(turn.error)node.append(el('div','turn-error',turn.error.message||String(turn.error)));
   next.append(node);
  }
  for(const receipt of receipts){const node=cache.render('receipt:'+receipt.id,receipt.status,()=>{const node=renderItem({id:receipt.id,type:'userMessage',content:receipt.content},{threadId:s.id,side:true});node.dataset.sendReceipt=receipt.id;const status=el('div','user-message-time',sendReceiptLabels[receipt.status as keyof typeof sendReceiptLabels]);status.setAttribute('role','status');node.append(status);return node;});next.append(node);}
  reconcileMessages(output,next);cache.bind(output);follow.schedule();resize();
 }
 async function refresh(){const s=selected;if(!s||s.refreshing)return;if(!s.id){await create(s);return;}s.refreshing=true;try{s.updatedTurns=new Set();const data=await api('/api/threads/'+s.id+'/side-chat-view');const updated=s.updatedTurns;s.turns=[...data.turns.filter(t=>!updated.has(t.id)),...s.turns.filter(t=>updated.has(t.id))];if(!updated.size)s.active=data.thread.status?.type==='active';s.error=s.uncertain?'上次发送结果未确认，请核对回复后再继续。':'';}catch(e){s.error=(e as ApiError).message;if((e as ApiError).code==='SIDE_CHAT_EXPIRED')s.expired=true;}finally{s.refreshing=false;s.updatedTurns=null;}if(s===selected)render();}
 async function restartExpired(){const old=selected;if(!old?.expired||old.creating)return;const s:SideState={parent:old.parent,cwd:old.cwd,requestId:crypto.randomUUID(),draft:old.draft,selections:old.selections.slice(),turns:[],model:old.model,effort:old.effort};attachments.moveDraft(old.id||old.requestId,s.requestId);chats.set(s.parent,s);selected=s;input.value=s.draft;render();await create(s);}
 async function create(s:SideState){if(s.id||s.creating)return;s.creating=true;s.error='';render();try{const d=await api('/api/threads/'+s.parent+'/side-chat',{method:'POST',body:{requestId:s.requestId,model:s.model,effort:s.effort}});attachments.moveDraft(s.requestId,d.thread.id);s.id=d.thread.id;s.cwd=d.thread.cwd||s.cwd;}catch(e){s.error=(e as ApiError).message;notify((e as ApiError).message,true);}finally{s.creating=false;if(s===selected){render();requestsChanged();}}}
 return {
  requestsHost,get id(){return selected?.id;},get visibleId(){return panel.hidden||selected?.expired?null:selected?.id;},requests:()=>[...chats.values()].flatMap(s=>s.id?asyncQuestions(s.turns,s.id):[]),
  openExisting(data:SideResponse & {parentThreadId:string}){
   const c=context();if(c.id!==data.parentThreadId)throw Error('主会话已切换，请重新点击通知。');
   let s=[...chats.values()].find(s=>s.id===data.thread.id);
   if(!s){s={parent:c.id,cwd:data.thread.cwd||c.cwd,requestId:crypto.randomUUID(),id:data.thread.id,draft:'',selections:[],turns:data.turns,active:data.thread.status?.type==='active',model:typeof data.thread.model==='string'?data.thread.model:c.model,effort:typeof data.thread.reasoningEffort==='string'?data.thread.reasoningEffort:c.effort};}
   // Existing local turns may already contain newer SSE events than the lookup.
   const previous=chats.get(c.id);if(previous&&previous!==s)chats.set(previous.id||previous.requestId,previous);
   for(const [key,value] of chats)if(value===s&&key!==c.id)chats.delete(key);
   chats.set(c.id,s);selected=s;
   input.value=s.draft;view.setVisible(true);view.setEntryVisible(true);document.body.classList.add('side-chat-open');render();requestsChanged();input.focus();void refresh();
  },
  async open(fragment:SideFragment){const c=context();if(!c.ready){notify('连接恢复后可打开侧边聊天。',true);return;}let s=chats.get(c.id);if(!s){const m=c.models.find(m=>m.id===c.model);s={parent:c.id,cwd:c.cwd,requestId:crypto.randomUUID(),draft:'',selections:[],turns:[],model:c.model,effort:m?.efforts.includes('medium')?'medium':m?.defaultEffort||m?.efforts[0]||c.effort};chats.set(c.id,s);}selected=s;if(s.selections.length>=20){notify('每条消息最多选择 20 个文本片段。',true);return;}s.selections.push({text:fragment.text,source:fragment.source,range:fragment.range});input.value=s.draft;view.setVisible(true);view.setEntryVisible(true);document.body.classList.add('side-chat-open');render();input.focus();await create(s);},
  event(method:string,p:EventParams){const s=[...chats.values()].find(s=>s.id&&(s.id===p.threadId||s.id===p.thread?.id));if(s){s.updatedTurns?.add((p.turnId||p.turn?.id)! );applySideEvent(s.turns,method,p);if(method==='item/completed'||method==='turn/completed')requestsChanged();if(method==='turn/started')s.active=true;if(method==='turn/completed')s.active=false;if(method==='thread/status/changed')s.active=(p.status as {type?:string}|undefined)?.type==='active';if(method==='thread/closed'||method==='side-chat/expired'){s.expired=true;s.active=false;s.error='临时聊天已过期，请开始新侧聊。';selectionChanged();}if(method==='error')s.error=(p.error as {message?:string}|undefined)?.message||'侧边聊天发生错误。';if(s===selected&&!panel.hidden&&!frame)frame=requestAnimationFrame(()=>{frame=null;render();});}if(method==='manager/status'&&selected&&!panel.hidden)renderControls();},
  sync(){const next=chats.get(context().id)||null;if(selected!==next){composer?.dismiss();settings.open=false;view.setVisible(false);document.body.classList.remove('side-chat-open');selected=next;input.value=selected?.draft||'';clearRequestCards(requestsHost);composer?.render();attachments?.render();}view.setEntryVisible(!!selected);selectionChanged();if(selected&&!panel.hidden)renderControls();},
  fragments:()=>panel.hidden?[]:selected?.selections||[],reconnect(){if(selected?.id)void refresh();}
 };
}
