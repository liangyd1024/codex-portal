import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {
 variant:string;label:unknown;host:unknown;user:unknown;version:unknown;connectedAt:unknown;transport:unknown;
 icon:'link'|'close';connectLabel:string;connectDisabled:boolean;reloadDisabled:boolean;releaseDisabled:boolean;releaseLabel:string;
 releaseReason:string|null;feedback:string;ready:boolean;
}
interface Actions {connect:()=>unknown;reload:()=>unknown;release:()=>unknown}
const store=createStore<{view:View;actions:Actions|null}>(()=>({actions:null,view:{variant:'',label:'未连接',host:'目标机器',user:'—',version:'—',connectedAt:'—',transport:'本机浏览器',icon:'link',connectLabel:'连接目标机器',connectDisabled:false,reloadDisabled:true,releaseDisabled:true,releaseLabel:'停止目标服务（影响所有入口）',releaseReason:null,feedback:'',ready:false}}));
export function publishConnectionSettings(patch:Partial<View>){
 const current=store.getState().view;
 if(!Object.entries(patch).some(([key,value])=>current[key as keyof View]!==value))return;
 flushSync(()=>store.setState({view:{...current,...patch}}));
}
export function installConnectionActions(actions:Actions){flushSync(()=>store.setState({actions}));}
const text=(value:unknown)=>value==null||value===''?'—':String(value);
export function ConnectionSettings(){
 const {view,actions}=useStore(store,state=>state);
 return <><summary className="section-title"><svg className="icon"><use href="#i-monitor"/></svg><h3>目标机器连接</h3></summary><div className="connection-summary"><span className={'connection-dot'+(view.ready?' '+view.variant:'')} id="inspector-dot"/><strong id="inspector-connection">{text(view.label)}</strong><span id="transport-label">{text(view.transport)}</span></div><dl className="detail-list"><div><dt>机器</dt><dd id="detail-host">{text(view.host)}</dd></div><div><dt>用户</dt><dd id="detail-user">{text(view.user)}</dd></div><div><dt>Codex 版本</dt><dd id="detail-version">{text(view.version)}</dd></div><div><dt>连接时间</dt><dd id="detail-connected">{text(view.connectedAt)}</dd></div></dl><button className="secondary-button full-width" id="connect-button" disabled={view.connectDisabled} onClick={()=>actions?.connect()}><svg className="icon" aria-hidden={view.ready?'true':undefined}><use href={'#i-'+view.icon}/></svg><span>{view.connectLabel}</span></button><button className="secondary-button full-width" id="reload-login" disabled={view.reloadDisabled} onClick={()=>actions?.reload()}>重新加载登录</button><button className="text-button release-button" id="release-service" disabled={view.releaseDisabled} aria-describedby={view.releaseReason===null?undefined:'reason-release-service'} onClick={()=>actions?.release()}>{view.releaseLabel}</button>{view.releaseReason!==null&&<p className="control-reason" id="reason-release-service" hidden={!view.releaseDisabled}>{view.releaseReason}</p>}<p id="maintenance-feedback" className="subtle" role="status" hidden={!view.feedback}>{view.feedback}</p></>;
}
