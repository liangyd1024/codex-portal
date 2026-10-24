import {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {goalPresentation,goalDuration} from '../../../public/goal-toolbar.js';
interface Goal {status:string;objective?:string;timeUsedSeconds?:number;[key:string]:unknown}
interface Context {id:string|null;goal?:Goal|null;goalError?:unknown;draft?:boolean;ephemeral?:boolean;ready:boolean;busy:boolean;active:boolean}
interface Options {input:HTMLTextAreaElement;context:()=>Context;api:(path:string,options:{method:'POST';body:{clear:true}|{status:string}})=>Promise<unknown>;refresh:()=>Promise<unknown>;edit:(anchor:HTMLButtonElement)=>void}
interface View {hidden:boolean;pending:boolean;label:string;objective:string;duration:string;disabled:boolean;action:string|null;toggleDisabled:boolean;feedback:string}
function Icon({kind}:{kind:'goal'|'clear'|'paused'|'active'}){
 return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{kind==='goal'?<><circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><path d="m11 13 9-9m-5 0h5v5"/></>:kind==='clear'?<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/>:<><circle cx="12" cy="12" r="9"/><path d={kind==='paused'?'M10 8v8m4-8v8':'m10 8 6 4-6 4Z'}/></>}</svg>;
}
function Toolbar({bar,store,edit,mutate}:{bar:HTMLElement;store:StoreApi<{view:View|null}>;edit:Options['edit'];mutate:(clear:boolean)=>Promise<void>}){
 const v=useStore(store).view,name=v?.action==='paused'?'暂停目标':'继续目标';
 // This component alone owns the existing section and its children; no wrapper changes layout.
 useLayoutEffect(()=>{if(v){bar.hidden=v.hidden;bar.setAttribute('aria-busy',String(v.pending));}},[bar,v]);
 return <><button type="button" className="goal-edit" aria-label="编辑目标" title="编辑目标" disabled={v?.disabled} onClick={e=>{if(!e.currentTarget.disabled)edit(e.currentTarget);}}><Icon kind="goal"/><span className="goal-toolbar-info"><strong title={v?.objective}>{v?.label}</strong><span className="goal-toolbar-usage">{v?.duration}</span></span></button><button type="button" className="goal-clear" aria-label="删除目标" title="删除目标" disabled={v?.disabled} onClick={()=>void mutate(true)}><Icon kind="clear"/></button><button type="button" className="goal-toggle" hidden={v?!v.action:undefined} disabled={v?.toggleDisabled} title={v?name:undefined} aria-label={v?name:undefined} data-action={v?v.action||'':undefined} onClick={()=>void mutate(false)}>{v&&<Icon kind={v.action==='paused'?'paused':'active'}/>}</button><span className="goal-toolbar-feedback" role="status">{v?.feedback}</span></>;
}
export function installReactGoalToolbar({input,context,api,refresh,edit}:Options){
 const bar=document.createElement('section');bar.className='goal-toolbar';bar.hidden=true;bar.setAttribute('aria-label','会话目标');input.form!.before(bar);
 const store=createStore<{view:View|null}>(()=>({view:null})),root=createRoot(bar);
 let pending=false,error='',errorId:string|null=null;
 function render(){
  const c=context(),presentation=goalPresentation(c.goal,c.goalError),disabled=pending||!c.ready||c.busy||Boolean(c.goalError)||!c.goal;
  const view:View={hidden:Boolean(c.draft||c.ephemeral||!presentation.visible),pending,label:presentation.label,objective:c.goal?.objective||'',duration:goalDuration(c.goal?.timeUsedSeconds),disabled,action:presentation.action,toggleDisabled:disabled||(presentation.action==='active'&&c.active),feedback:errorId===c.id?error:''};
  const previous=store.getState().view;if(previous&&Object.entries(view).every(([key,value])=>Object.is(previous[key as keyof View],value)))return;
  flushSync(()=>store.setState({view}));
 }
 async function mutate(clearGoal:boolean){
  const c=context(),view=goalPresentation(c.goal,c.goalError);
  if(pending||!c.ready||c.busy||c.goalError||!c.goal||(!clearGoal&&(!view.action||(view.action==='active'&&c.active))))return;
  const id=c.id;pending=true;error='';errorId=id;render();
  try{await api('/api/threads/'+encodeURIComponent(String(id))+'/goal',{method:'POST',body:clearGoal?{clear:true}:{status:view.action!}});if(context().id===id){await refresh();if(clearGoal&&context().id===id&&!context().goal)input.focus();}}
  catch(e){if(context().id===id)error='目标操作未确认：'+(e as {message:string}).message;}
  finally{pending=false;render();}
 }
 flushSync(()=>root.render(<Toolbar bar={bar} store={store} edit={edit} mutate={mutate}/>));
 return {render};
}
