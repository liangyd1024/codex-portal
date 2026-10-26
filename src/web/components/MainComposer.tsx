import type {ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
interface InputView {disabled:boolean;placeholder:string}
const inputStore=createStore<InputView>(()=>({disabled:true,placeholder:'正在确认会话…'}));
const formStore=createStore<{busy?:string}>(()=>({}));
export function publishMessageInput(patch:Partial<InputView>){const old=inputStore.getState();if(Object.entries(patch).every(([key,value])=>old[key as keyof InputView]===value))return;flushSync(()=>inputStore.setState(patch));}
export function publishComposerBusy(busy:boolean){const value=String(busy);if(formStore.getState().busy!==value)flushSync(()=>formStore.setState({busy:value}));}
export function MainMessageInput(){const view=useStore(inputStore);return <textarea inputMode="text" enterKeyHint="enter" autoComplete="off" id="message-input" placeholder={view.placeholder} rows={1} disabled={view.disabled}/>;}
export function MainComposerForm({children}:{children:ReactNode}){const busy=useStore(formStore,s=>s.busy);return <form id="message-form" className="composer" autoComplete="off" aria-busy={busy as 'true'|'false'|undefined}>{children}</form>;}
