import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {COMPACT_QUERY} from '../../../public/mobile-ui.js';
interface Option {root: string; name: string}
interface View {active: boolean; options: Option[]; value: string; disabled: boolean}
interface Actions {change?: (value: string) => void; browse?: (anchor: HTMLButtonElement) => void}
const store=createStore<{view:View;actions:Actions}>(()=>({view:{active:false,options:[],value:'',disabled:false},actions:{}}));
export function publishProjectPicker(patch:Partial<View>){
 const view=store.getState().view;
 if(Object.entries(patch).every(([key,value])=>Object.is(view[key as keyof View],value)))return;
 flushSync(()=>store.setState({view:{...view,...patch}}));
}
export function installProjectPickerActions(actions:Actions){store.setState(state=>({actions:{...state.actions,...actions}}));}
export function ProjectPicker(){
 const view=useStore(store,s=>s.view),select=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const [expanded,setExpanded]=useState(false),[query,setQuery]=useState('');
 const composing=useRef(false),compositionEnded=useRef(0),backdrop=useRef(false);
 const page=()=>document.getElementById('new-chat-page')!;
 const close=()=>dialog.current?.close();
 const name=view.options.find(o=>o.root===view.value)?.name||'选择项目';
 useLayoutEffect(()=>{if(select.current)select.current.value=view.value;},[view.value,view.options]);
 useLayoutEffect(()=>{
  if(!view.active)return;
  const media=matchMedia(COMPACT_QUERY),sync=()=>{if(dialog.current?.open&&(page().hidden||store.getState().view.disabled))close();};
  const changed=()=>{if(dialog.current?.open)close();};
  const observer=new MutationObserver(sync);observer.observe(page(),{attributes:true,attributeFilter:['hidden']});media.addEventListener('change',changed);
  return()=>{observer.disconnect();media.removeEventListener('change',changed);};
 },[view.active]);
 useLayoutEffect(()=>{if(dialog.current?.open&&view.disabled)close();},[view.disabled]);
 function choose(value:string){publishProjectPicker({value});store.getState().actions.change?.(value);}
 function open(){
  if(store.getState().view.disabled||page().hidden)return;
  if(search.current)search.current.value='';flushSync(()=>{setQuery('');setExpanded(true);});
  dialog.current!.showModal();
  if(!matchMedia(COMPACT_QUERY).matches)search.current!.focus({preventScroll:true});
  list.current!.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest'});
 }
 // Keep the closed dialog's last rendered list, as the original lazy picker did.
 const snapshot=useRef({options:[] as Option[],value:'',initialized:false});
 if(expanded)snapshot.current={options:view.options,value:view.value,initialized:true};
 const shown=snapshot.current;
 const names=useMemo(()=>{const result=new Map<string,number>();for(const o of shown.options)result.set(o.name,(result.get(o.name)||0)+1);return result;},[shown.options]);
 const listVersion=useRef({signature:'',revision:0});
 const signature=useMemo(()=>JSON.stringify([shown.options.map(o=>[o.name,o.root,o.root===shown.value]),query]),[shown.options,shown.value,query]);
 if(listVersion.current.signature!==signature){listVersion.current={signature,revision:listVersion.current.revision+1};}
 const listKey=listVersion.current.revision+':';
 const filtered=useMemo(()=>shown.options.filter(o=>(o.name+' '+o.root).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[shown.options,query]);
 const options=useMemo(()=>view.options.map((o,index)=><option key={index} value={o.root}>{o.name}</option>),[view.options]);
 return <><label className="new-project-picker"><span className="sr-only">项目</span><select ref={select} id="new-cwd" aria-label="选择新会话项目" disabled={view.disabled} onChange={event=>choose(event.currentTarget.value)}>{options}</select></label>{view.active&&<>
  <button ref={trigger} type="button" id="project-picker-trigger" aria-haspopup="dialog" aria-controls="project-picker-dialog" aria-expanded={expanded} aria-label={'选择项目：'+name} disabled={view.disabled} onClick={open}>{name+' ⌄'}</button>
  {createPortal(<dialog ref={dialog} id="project-picker-dialog" aria-labelledby="project-picker-title"
   onCancel={event=>{if(composing.current||Date.now()-compositionEnded.current<100)event.preventDefault();}}
   onClose={()=>{setExpanded(false);if(!page().hidden)trigger.current?.focus({preventScroll:true});}}
   onPointerDown={event=>{backdrop.current=event.target===event.currentTarget;}}
   onClick={event=>{if(backdrop.current&&event.target===event.currentTarget)close();}}
   onKeyDown={event=>{
    if(event.nativeEvent.isComposing||composing.current||event.keyCode===229||Date.now()-compositionEnded.current<100){event.stopPropagation();return;}
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.target===search.current&&event.key==='Enter')event.preventDefault();
    if(['ArrowDown','ArrowUp'].includes(event.key)){
     const buttons=[...list.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
     const next=index<0?(event.key==='ArrowDown'?0:buttons.length-1):Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));
     if(buttons[next]){event.preventDefault();buttons[next].focus();}
    }
   }}>
   <header><h2 id="project-picker-title">选择项目</h2><button ref={node=>{if(node)node.autofocus=true;}} type="button" className="icon-button" aria-label="关闭项目选择" onClick={close}>×</button></header>
   <input ref={search} id="project-picker-search" type="search" placeholder="搜索项目" aria-label="搜索项目" autoComplete="off" enterKeyHint="search"
    onInput={event=>{if(!composing.current)setQuery(event.currentTarget.value);}}
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={event=>{composing.current=false;compositionEnded.current=Date.now();setQuery(event.currentTarget.value);}}/>
   <div ref={list} id="project-picker-list" aria-label="项目列表">{filtered.map((option,index)=><button key={listKey+index} type="button" className="project-picker-option" aria-pressed={option.root===shown.value} onClick={()=>{
    const current=store.getState().view;if(current.disabled||page().hidden||!current.options.includes(option))return;
    choose(option.root);close();
   }}><span>{option.name}</span>{names.get(option.name)!>1&&<small>{option.root}</small>}</button>)}</div>
   <p id="project-picker-empty" role="status" hidden={!shown.initialized||Boolean(filtered.length)}>{!shown.initialized||shown.options.length?'未找到匹配项目':'暂无可选项目'}</p>
   <button type="button" id="project-picker-browse" onClick={()=>{close();store.getState().actions.browse?.(trigger.current!);}}>浏览文件夹 / 新建项目</button>
  </dialog>,document.body)}
 </>}</>;
}
