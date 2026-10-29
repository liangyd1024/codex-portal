import {Fragment,useLayoutEffect,useMemo,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {skillPresentation} from '../../../public/skill-suggestions.js';
interface Entry {name?:string;path?:string;mentionKind?:string;[key:string]:unknown}
interface Content {label:string;kind:string;rows:Entry[];messages:string[]}
type View={revision:number;text:string}|({revision:number;index:number}&Content);
interface Instance {id:number;box:HTMLElement;choose:(entry:Entry)=>void;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Suggestions({box,choose,store}:Instance){
 const selected=useRef<{revision:number;nodes:Element[];index:number}|null>(null);
 const v=useStore(store).view,content=v&&!('text' in v)?v:null;
 const rows=useMemo(()=>content?.rows.map((entry,i)=>{
  const kind=entry.mentionKind||content.kind,view=skillPresentation(entry);
  return <button key={i} type="button" id={box.id+'-option-'+i} role="option" title={[view.name,view.description,view.source,entry.path].filter(Boolean).join('\n')} onPointerDown={e=>{if(e.pointerType==='mouse')e.preventDefault();}} onClick={()=>choose(entry)}><svg className="icon" aria-hidden="true"><use href={kind==='threads'?'#i-chat':'#i-mark'}/></svg><strong title={String(entry.name)}>{view.name}</strong><span className="skill-description">{view.description}</span><span className="skill-source">{kind==='files'?(entry.matchType==='directory'?'文件夹':'文件'):kind==='apps'?'应用':kind==='skills'?'技能':kind==='threads'?'会话':kind==='plugins'?'插件':view.source}</span></button>;
 }),[content?.rows,content?.kind,box.id,choose]);
 // This component alone writes selection attributes. Reuse unchanged React rows
 // while preserving the baseline list update and scroll/focus behavior.
 useLayoutEffect(()=>{
  if(!content){selected.current=null;return;}
  if(selected.current?.revision!==content.revision){const nodes=[...box.querySelectorAll('[role=option]')];nodes.forEach((node,i)=>node.setAttribute('aria-selected',String(i===content.index)));selected.current={revision:content.revision,nodes,index:content.index};}
  else if(selected.current.index!==content.index){const previous=selected.current;previous.nodes[previous.index]?.setAttribute('aria-selected','false');previous.nodes[content.index]?.setAttribute('aria-selected','true');previous.index=content.index;}
 },[box,content]);
 if(!v)return null;
 return createPortal(<Fragment key={v.revision}>{'text' in v?v.text:<><div className="skill-suggestions-heading">{v.label}</div>{rows}{v.messages.map((text,i)=><div className="skill-suggestions-status" key={i}>{text}</div>)}</>}</Fragment>,box);
}
export function SkillSuggestions(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Suggestions key={instance.id} {...instance}/>)}</>;}
export function installReactSkillSuggestionsView({box,choose}:Pick<Instance,'box'|'choose'>){
 const store=createStore<{view:View|null}>(()=>({view:null}));let revision=0;
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,{id:++sequence,box,choose,store}]}));
 const publish=(view:View)=>flushSync(()=>store.setState({view}));
 return {text:(text:string)=>publish({revision:++revision,text}),render:(content:Content)=>publish({...content,revision:++revision,index:0}),highlight(index:number){const v=store.getState().view;if(v&&!('text' in v)&&v.index!==index)publish({...v,index});}};
}
