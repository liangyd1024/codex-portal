import {Fragment,createRef,useRef,useLayoutEffect,type RefObject} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {SideAttachments} from './Attachments';
interface Actions {close:()=>unknown;stop:()=>unknown;retry:()=>unknown;unlock:()=>unknown;restart:()=>unknown;reopen:()=>unknown;model:()=>unknown;effort:()=>unknown}
interface Controls {
 status:string;sendDisabled:boolean;sendLabel:string;inputDisabled:boolean;placeholder:string;
 stopHidden:boolean;stopDisabled:boolean;retryHidden:boolean;unlockHidden:boolean;restartHidden:boolean;restartDisabled:boolean;
 models:{id:string;label:string;efforts:string[]}[];model:string;effort:string;modelDisabled:boolean;
}
interface Fragments {texts:string[];remove:(index:number)=>void;revision:number}
interface View {visible:boolean;entryVisible:boolean;fragments:Fragments|null}
interface Nodes {panel:HTMLElement;close:HTMLButtonElement;scroller:HTMLDivElement;output:HTMLDivElement;requestsHost:HTMLDivElement;form:HTMLFormElement;input:HTMLTextAreaElement;settings:HTMLDetailsElement;summary:HTMLElement;model:HTMLSelectElement;effort:HTMLSelectElement;send:HTMLButtonElement;entry:HTMLButtonElement}
type Refs={[K in keyof Nodes]:RefObject<Nodes[K]|null>};
interface Instance {actions:Actions;refs:Refs;store:StoreApi<View>;controls:StoreApi<Controls|null>}
const registry=createStore<{instance:Instance|null}>(()=>({instance:null}));
function Icon({name}:{name:string}){return <svg className="icon"><use href={'#i-'+name}/></svg>;}
function Panel({instance:i}:{instance:Instance}){
 const v=useStore(i.store),r=i.refs;
 const status=useRef<HTMLParagraphElement>(null),stop=useRef<HTMLButtonElement>(null),retry=useRef<HTMLButtonElement>(null),unlock=useRef<HTMLButtonElement>(null),restart=useRef<HTMLButtonElement>(null),recovery=useRef<HTMLDivElement>(null),modelLabel=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  let controlsKey='';
  const apply=()=>{const c=i.controls.getState();if(!c)return;
   status.current!.textContent=c.status;status.current!.hidden=!c.status;
   r.send.current!.disabled=c.sendDisabled;r.send.current!.setAttribute('aria-label',c.sendLabel);r.input.current!.disabled=c.inputDisabled;r.input.current!.placeholder=c.placeholder;
   stop.current!.hidden=c.stopHidden;stop.current!.disabled=c.stopDisabled;retry.current!.hidden=c.retryHidden;unlock.current!.hidden=c.unlockHidden;restart.current!.hidden=c.restartHidden;restart.current!.disabled=c.restartDisabled;recovery.current!.hidden=c.retryHidden&&c.unlockHidden&&c.restartHidden;
   const key=JSON.stringify([c.model,c.effort,c.models]);if(key!==controlsKey){controlsKey=key;const model=r.model.current!,effort=r.effort.current!;model.replaceChildren(...c.models.map(m=>new Option(m.label,m.id)));model.value=c.model;effort.replaceChildren(...(c.models.find(m=>m.id===c.model)?.efforts||[c.effort]).map(value=>new Option(({low:'低',medium:'中',high:'高',xhigh:'超高'} as Record<string,string>)[value]||value,value)));effort.value=c.effort;modelLabel.current!.textContent=(c.models.find(m=>m.id===c.model)?.label||c.model)+' · '+(effort.selectedOptions[0]?.text||c.effort);}
   r.model.current!.disabled=r.effort.current!.disabled=c.modelDisabled;
  };
  apply();return i.controls.subscribe(apply);
 },[i]);
 return <aside ref={r.panel} className="side-chat-panel" hidden={!v.visible} aria-label="侧边聊天"><header><strong>侧边聊天</strong><small title="关闭面板后暂时保留；空闲 3 小时或刷新网页后可能失效。目标模式和定时任务请在主聊天使用。">临时聊天</small><button ref={r.close} className="secondary-button" type="button" onClick={i.actions.close}>关闭</button></header>
 <div ref={r.scroller} className="side-chat-output" tabIndex={0}><div ref={r.output} className="messages"/></div>
 <div className="composer-region side-chat-composer"><p ref={status} className="side-chat-status" role="status"/><div ref={r.requestsHost} className="conversation-requests"/><div ref={recovery} className="side-chat-recovery"><button ref={retry} className="secondary-button" type="button" onClick={i.actions.retry}>重新读取</button><button ref={unlock} className="secondary-button" type="button" onClick={i.actions.unlock}>已核对，允许继续</button><button ref={restart} className="secondary-button" type="button" onClick={i.actions.restart}>开始新侧聊</button></div>
 <form ref={r.form} className="composer"><SideAttachments/><details className="side-chat-fragments" hidden={v.fragments?!v.fragments.texts.length:undefined}><summary>{v.fragments?v.fragments.texts.length+' 个已选文本片段':null}</summary><div><Fragment key={v.fragments?.revision}>{v.fragments?.texts.map((text,index)=><blockquote key={index}>{(index+1)+'. '+text}<button className="secondary-button" type="button" onClick={()=>v.fragments!.remove(index)}>移除</button></blockquote>)}</Fragment></div></details><textarea ref={r.input} rows={1} placeholder="和 Codex 一起工作" aria-label="侧边聊天消息" enterKeyHint="enter"/>
 <div className="composer-bottom"><details ref={r.settings} className="composer-settings"><summary ref={r.summary} aria-label="侧边聊天模型与思考档位"><Icon name="mark"/><span ref={modelLabel} className="composer-model-label"/><Icon name="chevron"/></summary><div className="model-controls"><label className="select-control"><span className="sr-only">模型</span><select ref={r.model} aria-label="侧边聊天模型" onChange={i.actions.model}/></label><label className="select-control"><span className="sr-only">思考档位</span><select ref={r.effort} aria-label="侧边聊天思考档位" onChange={i.actions.effort}/></label></div></details><div className="send-actions"><button ref={stop} className="stop-button" type="button" aria-label="停止侧边聊天轮次" onClick={i.actions.stop}><Icon name="stop"/></button><button ref={r.send} className="send-button" type="submit"><Icon name="arrow"/></button></div></div></form></div></aside>;
}
export function SideChatPanel(){const i=useStore(registry).instance;return i?<Panel instance={i}/>:null;}
function Reopen({instance:i}:{instance:Instance}){const visible=useStore(i.store,s=>s.entryVisible);return <button ref={i.refs.entry} className="side-chat-reopen" type="button" hidden={!visible} onClick={i.actions.reopen}>侧边聊天</button>;}
export function SideChatReopen(){const i=useStore(registry).instance;return i?<Reopen instance={i}/>:null;}
export function installSideChatView(actions:Actions){
 const refs:Refs={panel:createRef(),close:createRef(),scroller:createRef(),output:createRef(),requestsHost:createRef(),form:createRef(),input:createRef(),settings:createRef(),summary:createRef(),model:createRef(),effort:createRef(),send:createRef(),entry:createRef()};
 const instance:Instance={actions,refs,store:createStore<View>(()=>({visible:false,entryVisible:false,fragments:null})),controls:createStore<Controls|null>(()=>null)};
 flushSync(()=>registry.setState({instance}));
 const nodes=Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,ref.current])) as unknown as Nodes;
 return {...nodes,setVisible(visible:boolean){if(instance.store.getState().visible!==visible)flushSync(()=>instance.store.setState({visible}));},setEntryVisible(entryVisible:boolean){if(instance.store.getState().entryVisible!==entryVisible)flushSync(()=>instance.store.setState({entryVisible}));},renderControls(view:Controls){instance.controls.setState(view);},renderFragments(texts:string[],remove:(index:number)=>void){flushSync(()=>instance.store.setState(s=>({fragments:{texts,remove,revision:(s.fragments?.revision||0)+1}})));}};
}
