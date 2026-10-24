import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {disabled:boolean;checked:boolean;testDisabled:boolean;status:string}
interface Actions {change:(enabled:boolean)=>unknown;test:()=>unknown}
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
 return <div className="notification-controls"><label><input id="task-notifications" type="checkbox" role="switch" disabled={view.disabled} checked={view.checked} onChange={event=>{const checked=event.target.checked;publishNotificationView({checked});actions?.change(checked);}}/>任务系统通知</label><button id="test-notification" className="text-button" type="button" disabled={view.testDisabled} onClick={()=>actions?.test()}>测试通知</button><span id="notification-status" role="status">{view.status}</span>{history.length>0&&<div className="notification-history" id="notification-history" role="log">{history.map(item=><p key={item.id}>{item.text}</p>)}</div>}</div>;
}
