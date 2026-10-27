import {useLayoutEffect,useRef} from 'react';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface Actions {enter:()=>unknown;review:()=>unknown}
interface View {entryHidden:boolean;entryDisabled:boolean;reviewHidden:boolean;reviewDisabled:boolean}
const actions=createStore<{value:Actions|null}>(()=>({value:null}));
const controls=createStore<View>(()=>({entryHidden:true,entryDisabled:false,reviewHidden:true,reviewDisabled:false}));
function DesktopButton({kind}:{kind:'entry'|'review'}){
 const callbacks=useStore(actions,s=>s.value),ref=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  const button=ref.current;if(!button||!callbacks)return;
  const apply=()=>{const view=controls.getState();button.hidden=view[kind==='entry'?'entryHidden':'reviewHidden'];button.disabled=view[kind==='entry'?'entryDisabled':'reviewDisabled'];};
  button.onclick=()=>callbacks[kind==='entry'?'enter':'review']();apply();
  const unsubscribe=controls.subscribe(apply);return()=>{unsubscribe();button.onclick=null;};
 },[callbacks,kind]);
 return callbacks?<button ref={ref} id={'desktop-'+kind} className="text-button" type="button">{kind==='entry'?'恢复桌面连接':'已核对会话记录，解锁发送'}</button>:null;
}
export function DesktopEntry(){return <DesktopButton kind="entry"/>;}
export function DesktopReview(){return <DesktopButton kind="review"/>;}
export function installDesktopControls(value:Actions){flushSync(()=>actions.setState({value}));}
export function publishDesktopControls(view:Partial<View>){controls.setState(view);}
