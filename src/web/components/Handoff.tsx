import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {createHandoffController,type HandoffView} from '../services/thread-handoff';
const store=createStore<{controller:ReturnType<typeof createHandoffController>|null;view:HandoffView|null}>(()=>({controller:null,view:null}));
export function HandoffButton(){
 const {controller,view}=useStore(store);
 return controller?<button type="button" id="handoff-thread" className="text-button handoff-button" hidden={view?.buttonHidden} disabled={view?.buttonDisabled} title={view?.buttonTitle} onClick={()=>controller.run()}>{view?.buttonText||'交还桌面端'}</button>:null;
}
export function HandoffBanner(){
 const {controller,view}=useStore(store);
 return controller?<div id="handoff-status" className={'handoff-status'+(view?.error?' error':'')} hidden={view?.bannerHidden??true} tabIndex={-1} aria-busy={view?String(view.busy) as 'true'|'false':undefined}><span role="status" aria-live="polite">{view?.message}</span><button type="button" className="text-button" hidden={view?.retryHidden} disabled={view?.retryDisabled} onClick={()=>controller.run()}>重试交还</button><button type="button" className="icon-button handoff-dismiss" aria-label="关闭交还提示" hidden={view?.closeHidden} onClick={()=>controller.dismiss()}>×</button></div>:null;
}
export function installReactHandoff({endUse}:{endUse:()=>unknown}){
 if(!document.querySelector('link[href="/handoff.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/handoff.css';document.head.append(link);}
 const controller=createHandoffController({endUse,publish:view=>flushSync(()=>store.setState({view})),focus:banner=>document.getElementById(banner?'handoff-status':'handoff-thread')!.focus(),restoreFocus:()=>{const button=document.getElementById('handoff-thread')!;if(!button.hidden&&button.checkVisibility?.())button.focus();else document.getElementById('message-input')!.focus();}});
 flushSync(()=>store.setState({controller}));return controller;
}
