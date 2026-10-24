import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
import {installSystemUpdate as installController,type UpdateView} from '../services/system-update';
const store=createStore<{view:UpdateView|null;submit:(()=>Promise<void>)|null}>(()=>({view:null,submit:null}));
export function installSystemUpdate(deps:Omit<Parameters<typeof installController>[0],'publish'>){
 const controller=installController({...deps,publish:view=>flushSync(()=>store.setState({view}))});
 flushSync(()=>store.setState({submit:controller.submit}));
 return controller;
}
export function SystemUpdateView(){
 const {view,submit}=useStore(store,state=>state);
 if(!view)return null;
 return <><p className="subtle">更新当前网页服务，连接会短暂断开并自动恢复。</p><p className="subtle system-update-versions" title={view.title}>{view.versions}</p><p role="status" aria-live="polite">{view.status}</p><progress className="system-update-progress" aria-label="更新进行中" hidden={view.progressHidden} aria-valuetext={view.progressText}/><p className="system-update-steps" hidden={view.stepsHidden}>{view.steps}</p><div className="settings-actions"><button type="button" className="secondary-button" disabled={view.disabled} onClick={()=>void submit?.()}>{view.button}</button></div></>;
}
