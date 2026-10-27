import type {NativeTurn} from '../../contracts/native';
import {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {completedPlan} from '../../../public/composer.js';
interface Plan {turnId:string;text:string}
interface RecordState {turnId:string;state:'open'|'dismissed'|'sent'|'uncertain';error?:string}
interface Context {id:string|null;draft?:boolean;desktop?:boolean;planSupported?:boolean;turns:NativeTurn[];active:boolean;ready:boolean;busy:boolean}
interface Options {host:string;context:()=>Context;resetMode:()=>void;send:(id:string,plan:Plan)=>Promise<unknown>;notify:(message:string,negative:boolean)=>void;input?:HTMLTextAreaElement}
interface View {hidden:boolean;sending:boolean;uncertain:boolean;yesDisabled:boolean;reviewDisabled:boolean;status:string}
function Card({card,store,dismiss,review,submit}:{card:HTMLElement;store:StoreApi<{view:View|null}>;dismiss:()=>void;review:()=>void;submit:()=>Promise<void>}){
 const v=useStore(store).view;
 useLayoutEffect(()=>{if(v){card.hidden=v.hidden;card.setAttribute('aria-busy',String(v.sending));}},[card,v]);
 return <><strong>执行此计划？</strong><div className="plan-completion-actions"><button type="button" disabled={v?.yesDisabled} hidden={v?.uncertain} onClick={()=>void submit()}>是，执行此计划</button><button type="button" disabled={v?.sending} onClick={dismiss}>暂不执行</button><button type="button" hidden={v?!v.uncertain:undefined} disabled={v?.reviewDisabled} onClick={review}>已核对未执行，重新选择</button></div><p role="status" hidden={v?!v.status:undefined}>{v?.status}</p></>;
}
export function installReactPlanCompletion({host,context,resetMode,send,notify,input=document.getElementById('message-input') as HTMLTextAreaElement}:Options){
 const key='rcm.planCompletion.'+host;let saved;
 try{saved=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
 const records:Record<string,RecordState>=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};
 const save=()=>{try{sessionStorage.setItem(key,JSON.stringify(records));}catch{notify('计划选项状态未保存，刷新后请核对会话。',true);}};
 const card=document.createElement('section');card.className='plan-completion';card.hidden=true;card.setAttribute('aria-label','执行计划');input.closest('form')!.before(card);
 const store=createStore<{view:View|null}>(()=>({view:null})),root=createRoot(card);
 let current:{id:string;plan:Plan}|null=null,pending:string|null=null;
 const record=(id:string,plan:Plan)=>records[id]?.turnId===plan.turnId?records[id]:null;
 function render(){
  const c=context(),plan:Plan|null=c.draft||c.desktop&&!c.planSupported?null:completedPlan(c.turns);
  current=plan?{id:c.id!,plan}:null;
  if(plan&&!record(c.id!,plan)){records[c.id!]={turnId:plan.turnId,state:'open'};resetMode();save();}
  const r=plan&&record(c.id!,plan),sending=pending===c.id,uncertain=r?.state==='uncertain'&&!sending;
  const view:View={hidden:!r||r.state==='dismissed'||r.state==='sent'||c.active,sending,uncertain,yesDisabled:!c.ready||c.busy||sending||uncertain,reviewDisabled:sending||!c.ready||c.busy,status:sending?'正在提交…':uncertain?'执行结果未确认，请先核对会话记录，避免重复执行。':r?.error||(!c.ready?'连接恢复后可执行，草稿已保留。':'')};
  const previous=store.getState().view;if(previous&&Object.entries(view).every(([k,v])=>Object.is(previous[k as keyof View],v)))return;
  flushSync(()=>store.setState({view}));
 }
 function dismiss(){if(!current||pending===current.id)return;records[current.id]!.state='dismissed';save();render();input.focus();}
 function review(){if(!current||store.getState().view?.reviewDisabled)return;records[current.id]!.state='open';delete records[current.id]!.error;save();render();card.querySelector<HTMLButtonElement>('button')!.focus();}
 async function submit(){
  if(!current||store.getState().view?.yesDisabled)return;
  const {id,plan}=current,r=record(id,plan)!;resetMode();pending=id;r.state='uncertain';delete r.error;save();render();
  try{await send(id,plan);r.state='sent';}
  catch(error){const e=error as {status:number;code:string;message:string};const rejected=e.status>=400&&e.status<500&&!['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(e.code);r.state=rejected?'open':'uncertain';r.error=e.message;notify(e.message,true);}
  finally{pending=null;save();render();if(context().id===id&&r.state==='sent')input.focus();}
 }
 card.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();dismiss();}});
 flushSync(()=>root.render(<Card card={card} store={store} dismiss={dismiss} review={review} submit={submit}/>));
 return {render};
}
