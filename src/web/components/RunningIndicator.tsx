import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
interface Activity {kind:string;source?:string|null;label:string;detail:string;terminals?:Array<{processId?:unknown;command?:string}>}
const store=createStore<{activity:Activity|null}>(()=>({activity:null}));
export function publishConversationActivity(activity:Activity|null){
 const old=store.getState().activity;
 if(old===activity)return;
 if(old&&activity&&old.kind===activity.kind&&old.source===activity.source&&old.label===activity.label&&old.detail===activity.detail){
  const previous=old.terminals??[],next=activity.terminals??[];
  if(previous.length===next.length&&previous.every((terminal,index)=>terminal.processId===next[index]?.processId&&terminal.command===next[index]?.command))return;
 }
 flushSync(()=>store.setState({activity}));
}
const Icon=({name}:{name:string})=><svg className="icon" aria-hidden="true"><use href={'#i-'+name}/></svg>;
export function RunningIndicator(){
 const a=useStore(store,s=>s.activity);
 const title=a?.kind==='question'?'需要你回答':a?.source==='cli'?'CLI 运行中':a?.source==='desktop'?'桌面运行中':'网页运行中';
 return <div id="running-indicator" className="running-indicator" role="status" hidden={!a}>{a&&(a.kind==='background'?<details className="background-processes"><summary>{a.label+' · '+a.detail}</summary><p>回复已结束，预览服务等后台命令可继续运行。展开查看命令；停止按钮仅停止这些后台命令。</p>{a.terminals?.map((terminal,index)=><div className="background-process" key={index}><span>{'后台命令 '+terminal.processId}</span><pre>{terminal.command||'命令内容暂不可用'}</pre></div>)}</details>:<>{a.kind==='question'||a.kind==='turn'?<span className={'activity-icon '+(a.kind==='question'?'activity-question':'activity-running activity-'+a.source)} title={title} role="img" aria-label={title}><Icon name={a.kind==='question'?'question':a.source==='cli'?'terminal':a.source==='desktop'?'monitor':'globe'}/></span>:<span className="activity-icon activity-unknown" aria-hidden="true"><Icon name="alert"/></span>}{a.label&&<span className="running-label">{a.label}</span>}{a.detail&&<span className="running-detail">{a.detail}</span>}</>)}</div>;
}
