import {useState,type ComponentType} from 'react';
import {createStore,useStore} from 'zustand';
import type {createApiClient} from '../services/api';
export interface ConnectionManagerOptions {api:ReturnType<typeof createApiClient>;flush:()=>void;enabled:boolean}
let savePending=false;
export const connectionSavePending=()=>savePending;
export function setConnectionSavePending(value:boolean){savePending=value;if(!value)window.dispatchEvent(new Event('rcm:configuration-idle'));}
const store=createStore<{options:ConnectionManagerOptions|null}>(()=>({options:null}));
export function installConnectionManager(options:ConnectionManagerOptions){store.setState({options});}
export function ConnectionManager(){
 const options=useStore(store,s=>s.options);
 const [Editor,setEditor]=useState<ComponentType<ConnectionManagerOptions&{closed:()=>void}>|null>(null);
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 if(!options?.enabled)return null;
 async function show(){setLoading(true);setError('');try{options!.flush();const module=await import('./ConnectionEditor');setEditor(()=>module.ConnectionEditor);setOpen(true);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <><button className="secondary-button full-width" disabled={loading} onClick={()=>void show()}>{loading?'正在打开…':'管理连接'}</button>{error&&<p role="alert" className="subtle">{error}</p>}{open&&Editor&&<Editor {...options} closed={()=>setOpen(false)}/>}</>;
}
