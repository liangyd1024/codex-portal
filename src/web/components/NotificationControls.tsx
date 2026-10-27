import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {disabled:boolean;checked:boolean;testDisabled:boolean;status:string}
interface Actions {change:(enabled:boolean)=>unknown}
interface State {view:View;actions:Actions|null}
const store=createStore<State>(()=>({view:{disabled:false,checked:false,testDisabled:true,status:'通知未开启'},actions:null}));
export function publishNotificationView(patch:Partial<View>){
 flushSync(()=>store.setState(state=>({view:{...state.view,...patch}})));
}
export function installNotificationActions(actions:Actions){flushSync(()=>store.setState({actions}));}
export function NotificationControls(){
 const {view,actions}=useStore(store,state=>state);
 return <div className="notification-controls"><label><input id="task-notifications" type="checkbox" role="switch" disabled={view.disabled} checked={view.checked} onChange={event=>{const checked=event.target.checked;publishNotificationView({checked});actions?.change(checked);}}/>任务系统通知</label><span id="notification-status" role="status">{view.status}</span></div>;
}
