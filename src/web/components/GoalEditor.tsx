import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Goal {objective:string;[key:string]:unknown}
interface Context {id:string|null;goal?:Goal|null;goalError?:unknown;ready:boolean;busy:boolean}
interface Draft {base:string;text:string;uncertain?:string}
interface Options {
 dialog:HTMLDialogElement;input:HTMLTextAreaElement;context:()=>Context;
 api:<T=unknown>(path:string,options?:{method:'POST';body:{objective:string;expectedObjective:string}})=>Promise<T>;
 open:(title:string,button:HTMLElement)=>Context;version:()=>number;opener:()=>HTMLElement|undefined;
 choice:()=>{goalEdit?:Draft};save:()=>void;render:()=>void;refresh:()=>Promise<unknown>;
 notify:(message:string,negative:boolean)=>void;updating:{get:()=>boolean;set:(value:boolean)=>void};
}
interface View {version:number;text:string;revision:number;feedback:string;reloadHidden:boolean;disabled:boolean;busy?:boolean;input:(text:string)=>void;reload:()=>void;submit:()=>void;cancel:()=>void}
interface Instance {id:number;dialog:HTMLDialogElement;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));
let sequence=0;
function Editor({dialog,store}:Instance){
 const v=useStore(store).view,area=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{if(v&&area.current)area.current.value=v.text;},[v?.version,v?.revision]);
 if(!v)return null;
 return createPortal(<form className="composer-goal" aria-busy={v.busy} onKeyDown={e=>{if((e.nativeEvent.isComposing||e.keyCode===229)&&e.key==='Enter')e.stopPropagation();}} onSubmit={e=>{e.preventDefault();v.submit();}}>
 <label>目标内容<textarea ref={area} required maxLength={10000} rows={7} readOnly={v.disabled} onInput={e=>v.input(e.currentTarget.value)}/></label><p role="status">{v.feedback}</p><div className="goal-edit-actions"><button type="button" hidden={v.reloadHidden} disabled={v.disabled} onClick={v.reload}>重新读取目标</button><button type="button" onClick={v.cancel}>取消</button><button type="submit" disabled={v.disabled}>保存</button></div>
 </form>,dialog);
}
export function GoalEditors(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Editor key={instance.id} {...instance}/>)}</>;}
export function installReactGoalEditor({dialog,input,context,api,open,version:dialogVersion,opener,choice,save,render,refresh,notify,updating}:Options){
 const store=createStore<{view:View|null}>(()=>({view:null}));
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,{id:++sequence,dialog,store}]}));
 const clear=()=>flushSync(()=>store.setState({view:null}));
 function edit(button:HTMLElement){
  const current=context();if(!current.goal||current.goalError){notify('目标暂未读取，请刷新后重试。',true);return;}
  dialog.classList.remove('catalog-dialog');
  const c=open('编辑目标',button),id=c.id,version=dialogVersion(),selection=choice();
  const draft=selection.goalEdit||(selection.goalEdit={base:c.goal!.objective,text:c.goal!.objective});
  let reloading=false;
  const same=()=>context().id===id&&dialog.open&&dialogVersion()===version;
  const update=(patch:Partial<View>)=>{const view=store.getState().view;if(view?.version===version)flushSync(()=>store.setState({view:{...view,...patch}}));};
  async function reload(){
   if(updating.get()||reloading)return;reloading=true;update({disabled:true});
   try{const detail=await api<{goal?:Goal|null;goalError?:unknown}>('/api/threads/'+encodeURIComponent(String(id)));if(!same())return;if(detail.goalError||!detail.goal)throw Error('目标暂未读取。');draft.base=detail.goal.objective;draft.text=draft.base;delete draft.uncertain;save();update({text:draft.text,revision:(store.getState().view?.revision||0)+1,feedback:'已读取当前目标。'});}
   catch(error){if(same())update({feedback:(error as {message:string}).message});}
   finally{reloading=false;if(same())update({disabled:false});}
  }
  async function submit(){
   if(updating.get()||reloading||!same())return;
   const now=context(),objective=dialog.querySelector<HTMLTextAreaElement>('textarea')!.value.trim();
   if(!now.ready||now.busy||now.goalError){update({feedback:'连接或目标状态尚未确认，草稿已保留。'});return;}
   if(!objective){update({feedback:'请填写目标内容。'});dialog.querySelector<HTMLTextAreaElement>('textarea')!.focus();return;}
   if(!draft.uncertain&&objective===draft.base.trim()&&now.goal?.objective===draft.base){delete selection.goalEdit;save();dialog.close();return;}
   updating.set(true);update({disabled:true,busy:true,feedback:'正在保存…'});render();let saved=false;
   try{
    const route='/api/threads/'+encodeURIComponent(String(id));
    if(draft.uncertain){const detail=await api<{goal?:Goal|null;goalError?:unknown}>(route);if(detail.goalError||!detail.goal)throw Error('上次保存结果仍未确认，请稍后重试。');if(detail.goal.objective===draft.uncertain)saved=true;else throw Error('上次保存结果未确认，请关闭编辑框并刷新目标后核对。');}
    else{draft.uncertain=objective;save();try{await api(route+'/goal',{method:'POST',body:{objective,expectedObjective:draft.base}});saved=true;}catch(error){const e=error as {status?:number;code?:string};if(e.status!==undefined&&e.status>=400&&e.status<500&&e.code!=='OUTCOME_UNKNOWN'){delete draft.uncertain;save();}throw error;}}
    if(saved){delete selection.goalEdit;save();if(same())dialog.close();if(context().id===id)await refresh();}
   }catch(error){if(same())update({reloadHidden:false,feedback:(saved?'目标已保存，刷新失败：':'保存未确认：')+(error as {message:string}).message});}
   finally{updating.set(false);if(same())update({disabled:false,busy:false});render();if(saved&&context().id===id&&dialogVersion()===version&&!dialog.open)opener()?.focus();}
  }
  const view:View={version,text:draft.text,revision:0,feedback:'',reloadHidden:!draft.uncertain&&draft.base===c.goal!.objective,disabled:false,input:text=>{draft.text=text;save();},reload:()=>void reload(),submit:()=>void submit(),cancel:()=>dialog.close()};
  flushSync(()=>store.setState({view}));dialog.querySelector<HTMLTextAreaElement>('textarea')!.focus();
 }
 return {clear,edit};
}
