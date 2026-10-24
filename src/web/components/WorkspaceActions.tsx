import {Fragment,useLayoutEffect,useRef} from 'react';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface WelcomeView {ready:boolean;icon:'link'|'plus';label:string}
const welcome=createStore<WelcomeView&{revision:number}>(()=>({ready:false,icon:'link',label:'连接 目标机器',revision:0}));
let welcomeButton:HTMLButtonElement|null=null;
const welcomeControl=createStore<{disabled:boolean;run?:()=>unknown}>(()=>({disabled:false}));
export function WelcomeConnect(){
 const view=useStore(welcome),ref=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{const button=ref.current!;welcomeButton=button;const apply=()=>{button.disabled=welcomeControl.getState().disabled;};button.onclick=()=>welcomeControl.getState().run?.();apply();const unsubscribe=welcomeControl.subscribe(apply);return()=>{unsubscribe();button.onclick=null;if(welcomeButton===button)welcomeButton=null;};},[]);
 return <button ref={ref} className="primary-button connect-action" id="welcome-connect"><Fragment key={view.revision}><svg className="icon" aria-hidden={view.ready?'true':undefined}><use href={'#i-'+view.icon}/></svg><span>{view.label}</span></Fragment></button>;
}
// Preserve baseline resets of hovered or selected children, without committing idle updates.
export function publishWelcome(view:WelcomeView){
 const old=welcome.getState(),button=welcomeButton,selection=button?.ownerDocument.getSelection();
 const selected=!!selection&&selection.rangeCount>0&&Array.from(button?.childNodes??[]).some(node=>selection.containsNode(node,true));
 if(old.ready===view.ready&&old.icon===view.icon&&old.label===view.label&&!button?.querySelector(':hover')&&!selected)return;
 flushSync(()=>welcome.setState({...view,revision:old.revision+1}));
}
export function setWelcomeDisabled(disabled:boolean){if(welcomeControl.getState().disabled!==disabled)welcomeControl.setState({disabled});}
export function installWelcomeAction(run:()=>unknown){welcomeControl.setState({run});}
const cacheAction=createStore<{run:(()=>unknown)|null}>(()=>({run:null}));
const cacheControl=createStore<{disabled:boolean}>(()=>({disabled:false}));
export function ClearRecovery(){
 const run=useStore(cacheAction,s=>s.run),ref=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{const button=ref.current;if(!button||!run)return;const apply=()=>{button.disabled=cacheControl.getState().disabled;};button.onclick=()=>run();apply();const unsubscribe=cacheControl.subscribe(apply);return()=>{unsubscribe();button.onclick=null;};},[run]);
 return run?<button ref={ref} className="text-button" type="button">清除日志缓存并重新加载</button>:null;
}
export function installClearRecovery(run:()=>unknown){flushSync(()=>cacheAction.setState({run}));return(disabled:boolean)=>cacheControl.setState({disabled});}
