import {Fragment,useLayoutEffect,useRef} from 'react';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface WelcomeView {ready:boolean;icon:'link'|'plus';label:string}
const welcome=createStore<WelcomeView&{revision:number}>(()=>({ready:false,icon:'link',label:'连接 目标机器',revision:0}));
const welcomeControl=createStore<{disabled:boolean;run?:()=>unknown}>(()=>({disabled:false}));
export function WelcomeConnect(){
 const view=useStore(welcome),ref=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{const button=ref.current!;const apply=()=>{button.disabled=welcomeControl.getState().disabled;};button.onclick=()=>welcomeControl.getState().run?.();apply();const unsubscribe=welcomeControl.subscribe(apply);return()=>{unsubscribe();button.onclick=null;};},[]);
 return <button ref={ref} className="primary-button connect-action" id="welcome-connect"><Fragment key={view.revision}><svg className="icon" aria-hidden={view.ready?'true':undefined}><use href={'#i-'+view.icon}/></svg><span>{view.label}</span></Fragment></button>;
}
// Baseline status updates rebuild the content; retaining it changes touch hover state.
export function publishWelcome(view:WelcomeView){flushSync(()=>welcome.setState(old=>({...view,revision:old.revision+1})));}
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
