import {useState,type ComponentType} from 'react';
import {createStore,useStore} from 'zustand';
import type {createApiClient} from '../services/api';
export interface ConnectionManagerOptions {api:ReturnType<typeof createApiClient>;flush:()=>void;enabled:boolean;targetId:string}
let savePending=false;
export const connectionSavePending=()=>savePending;
export function setConnectionSavePending(value:boolean){savePending=value;if(!value)window.dispatchEvent(new Event('rcm:configuration-idle'));}
const store=createStore<{options:ConnectionManagerOptions|null}>(()=>({options:null}));
export function installConnectionManager(options:ConnectionManagerOptions){store.setState({options});}
export function ConnectionManager(){
 const options=useStore(store,s=>s.options);
 const [Editor,setEditor]=useState<ComponentType<ConnectionManagerOptions&{closed:()=>void;initialConnection:string}>|null>(null);
 const [initialConnection,setInitialConnection]=useState('');
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function show(connection:string){if(!options?.enabled||loading)return;setInitialConnection(connection);setLoading(true);setError('');try{options!.flush();const module=await import('./ConnectionEditor');setEditor(()=>module.ConnectionEditor);setOpen(true);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <><div className="connection-management-actions"><button className="primary-button" disabled={!options?.enabled||loading} onClick={()=>void show('')}>添加机器</button><button className="secondary-button" disabled={!options?.enabled||loading} onClick={()=>void show(options!.targetId)}>管理连接</button></div>{(!options||!options.enabled||loading)&&<p className="subtle" role="status">{!options?'正在读取连接配置…':!options.enabled?'当前服务未启用连接管理。请更新网页服务后重试。':'正在打开…'}</p>}{error&&<p role="alert" className="subtle">{error}</p>}{open&&Editor&&options&&<Editor {...options} initialConnection={initialConnection} closed={()=>setOpen(false)}/>}</>;
}
