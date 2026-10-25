import {createRef,type RefObject} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import type {configureFeedbackViews} from '../services/feedback';
type Views=Parameters<typeof configureFeedbackViews>[0];
interface Toast {id:number;region:HTMLElement;node:RefObject<HTMLDivElement|null>;options:Parameters<Views['toast']>[1]}
interface Confirmation {node:RefObject<HTMLDialogElement|null>;cancel:RefObject<HTMLButtonElement|null>;options:Parameters<Views['confirm']>[0]}
const store=createStore<{toasts:Toast[];confirmation:Confirmation|null}>(()=>({toasts:[],confirmation:null}));let sequence=0;
export function FeedbackViews(){
 const {toasts,confirmation:c}=useStore(store);
 return <>{toasts.map(t=>createPortal(<div ref={t.node} className={'toast'+(t.options.error?' error':'')} role={t.options.error?'alert':'status'}><svg className="icon" aria-hidden="true"><use href={t.options.error?'#i-alert':'#i-check'}/></svg><p>{t.options.message}</p><button type="button" className="icon-button" aria-label="关闭提示" onClick={t.options.dismiss}><svg className="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div>,t.region,String(t.id)))}{c&&createPortal(<dialog ref={c.node} className="confirm-dialog" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-description" onCancel={event=>{event.preventDefault();c.options.finish(false);}} onClose={()=>c.options.finish(false)}><h2 id="confirm-action-title">{c.options.title}</h2><p id="confirm-action-description">{c.options.message}</p><div className="dialog-actions"><button ref={c.cancel} type="button" className="secondary-button" onClick={()=>c.options.finish(false)}>取消</button><button type="button" className={c.options.danger?'primary-button danger':'primary-button'} onClick={()=>c.options.finish(true)}>{c.options.accept}</button></div></dialog>,document.body)}</>;
}
export const reactFeedbackViews:Views={
 toast(region,options){
  const t:Toast={id:++sequence,region,node:createRef(),options};
  flushSync(()=>store.setState(s=>({toasts:[...s.toasts,t]})));
  return {node:t.node.current!,update:message=>flushSync(()=>store.setState(s=>({toasts:s.toasts.map(old=>old.id===t.id?{...old,options:{...old.options,message}}:old)}))),remove:()=>flushSync(()=>store.setState(s=>({toasts:s.toasts.filter(old=>old.id!==t.id)})))};
 },
 confirm(options){
  const c:Confirmation={node:createRef(),cancel:createRef(),options};
  flushSync(()=>store.setState({confirmation:c}));c.node.current!.showModal();c.cancel.current!.focus();
  return {close(){c.node.current!.close();flushSync(()=>store.setState({confirmation:null}));}};
 }
};
