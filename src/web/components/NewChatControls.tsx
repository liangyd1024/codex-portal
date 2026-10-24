import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {closeDisabled: boolean; retryHidden: boolean; errorHidden: boolean; error: string}
interface Actions {close: () => void; retry: () => void}
const store=createStore<{view: View; actions: Actions | null}>(()=>({view:{closeDisabled:false,retryHidden:true,errorHidden:true,error:''},actions:null}));
export function publishNewChatControls(patch: Partial<View>) {
 const previous=store.getState().view;
 if(Object.entries(patch).every(([key,value])=>Object.is(previous[key as keyof View],value)))return;
 flushSync(()=>store.setState({view:{...previous,...patch}}));
}
export function installNewChatActions(actions: Actions){store.setState({actions});}
export function NewChatBack(){const disabled=useStore(store,s=>s.view.closeDisabled);return <button type="button" className="text-button" id="close-new-chat" disabled={disabled} onClick={()=>store.getState().actions?.close()}>返回</button>;}
export function NewChatError(){const hidden=useStore(store,s=>s.view.errorHidden),text=useStore(store,s=>s.view.error);return <p id="new-chat-error" className="form-error" role="alert" hidden={hidden}>{text}</p>;}
export function NewChatRetry(){const hidden=useStore(store,s=>s.view.retryHidden);return <button id="new-retry-create" type="button" className="secondary-button" hidden={hidden} onClick={()=>store.getState().actions?.retry()}>已核对未创建，允许重试</button>;}
