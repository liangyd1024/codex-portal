import {useState} from 'react';
import type {LocalNotificationContext} from '../services/local-notification-test';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {disabled:boolean;checked:boolean;testDisabled:boolean;status:string}
interface Actions {change:(enabled:boolean)=>unknown;test:()=>unknown;localContext:()=>LocalNotificationContext;localTest:(host:string,threadId:string)=>Promise<string|undefined>}
interface State {view:View;actions:Actions|null;history:Array<{id:number;text:string}>;nextId:number}
const store=createStore<State>(()=>({view:{disabled:false,checked:false,testDisabled:true,status:'通知未开启'},actions:null,history:[],nextId:0}));
export function publishNotificationView(patch:Partial<View>){
 flushSync(()=>store.setState(state=>({view:{...state.view,...patch}})));
}
export function installNotificationActions(actions:Actions){flushSync(()=>store.setState({actions}));}
export function appendNotificationDiagnostic(text:string){
 flushSync(()=>store.setState(state=>({nextId:state.nextId+1,history:[{id:state.nextId,text},...state.history].slice(0,3)})));
}
export function NotificationControls(){
 const {view,actions,history}=useStore(store,state=>state);
 const [context,setContext]=useState<LocalNotificationContext|null>(null),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState('');
 const refresh=()=>{if(busy)return;const next=actions?.localContext();if(!next)return;setContext(next);setTarget(next.threads.some(t=>t.id===next.selectedId)?next.selectedId!:'');setResult('');};
 const run=async()=>{if(busy||!actions||!context||!target)return;setBusy(true);setResult('正在调用本机通知并核对保存目标…');try{const message=await actions.localTest(context.host,target);if(actions.localContext().host===context.host)setResult(message||'');}finally{setBusy(false);}};
 return <div className="notification-controls"><label><input id="task-notifications" type="checkbox" role="switch" disabled={view.disabled} checked={view.checked} onChange={event=>{const checked=event.target.checked;publishNotificationView({checked});actions?.change(checked);}}/>任务系统通知</label><button id="test-notification" className="text-button" type="button" disabled={view.testDisabled} onClick={()=>actions?.test()}>测试通知</button><span id="notification-status" role="status">{view.status}</span>{history.length>0&&<div className="notification-history" id="notification-history" role="log">{history.map(item=><p key={item.id}>{item.text}</p>)}</div>}<details className="notification-local" onToggle={event=>{if(event.currentTarget.open)refresh();}}><summary>通知诊断</summary><label htmlFor="local-notification-target">目标会话</label><select id="local-notification-target" value={target} disabled={busy} onChange={event=>{setTarget(event.target.value);setResult('');}}><option value="">请选择当前连接的会话</option>{context?.threads.map(thread=><option key={thread.id} value={thread.id}>{thread.name}</option>)}</select><button className="secondary-button" type="button" disabled={busy||view.disabled||!view.checked||!target} onClick={()=>void run()}>本机对照通知</button><p role="status">{result||'仅在本机生成通知，不发送远程推送。'}</p></details></div>;
}
