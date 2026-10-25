import {useShallow} from 'zustand/shallow';
import {Fragment,createRef,type RefObject} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import type {AnnotationActions,AnnotationViewState,AnnotationView,Marker,DraftRow} from '../services/response-annotations';
interface State extends AnnotationViewState {drafts:DraftRow[];draftRevision:number;markers:Marker[];markerRevision:number}
interface Instance {actions:AnnotationActions;store:StoreApi<State>;menu:RefObject<HTMLDivElement|null>;editor:RefObject<HTMLDivElement|null>;comment:RefObject<HTMLTextAreaElement|null>;chip:RefObject<HTMLButtonElement|null>;details:RefObject<HTMLDivElement|null>}
const registry=createStore<{instance:Instance|null}>(()=>({instance:null}));
function Drafts({instance:i}:{instance:Instance}){const v=useStore(i.store,useShallow(s=>({drafts:s.drafts,draftRevision:s.draftRevision,chipHidden:s.chipHidden,chipText:s.chipText,detailsHidden:s.detailsHidden,expanded:s.expanded})));return <><button ref={i.chip} type="button" className="annotation-chip" hidden={v.chipHidden} aria-expanded={String(v.expanded) as 'true'|'false'} onClick={i.actions.toggle}>{v.chipText}</button><div ref={i.details} className="annotation-drafts" hidden={v.detailsHidden}><Fragment key={v.draftRevision}>{v.drafts.map((row,index)=><div key={index} className="annotation-draft"><blockquote>{row.item.text}</blockquote><textarea defaultValue={row.item.annotation} aria-label="编辑注释评论" onInput={event=>row.edit(event.currentTarget.value)}/><button type="button" onClick={row.remove}>移除注释</button></div>)}</Fragment></div></>;}
export function AnnotationDrafts(){const i=useStore(registry,s=>s.instance);return i?<Drafts instance={i}/>:null;}
function Floating({instance:i}:{instance:Instance}){
 const v=useStore(i.store);
 return <>{createPortal(<div ref={i.menu} className="selection-actions" hidden={v.menuHidden} role="toolbar" aria-label="选中文本操作"><button type="button" onClick={i.actions.add}>添加到对话</button><button type="button" onClick={i.actions.side}>在侧边聊天中提问</button></div>,document.body)}{createPortal(<div ref={i.editor} className="annotation-editor" hidden={v.editorHidden} role="dialog" aria-label="添加注释"><strong>添加到对话</strong><blockquote className="annotation-excerpt">{v.excerpt}</blockquote><textarea ref={i.comment} placeholder="添加可选评论…" aria-label="注释评论" rows={2}/><div className="annotation-editor-actions"><button type="button" onClick={i.actions.dismiss}>取消</button><button type="button" className="annotation-submit" onClick={i.actions.commit}>添加</button></div></div>,document.body)}{createPortal(<div className="annotation-markers"><Fragment key={v.markerRevision}>{v.markers.map((marker,index)=><button key={index} type="button" className="annotation-marker" aria-label={marker.label} style={{left:marker.left+'px',top:marker.top+'px'}} onClick={marker.activate}>{marker.text}</button>)}</Fragment></div>,document.body)}</>;
}
export function AnnotationFloating(){const i=useStore(registry,s=>s.instance);return i?<Floating instance={i}/>:null;}
export function installReactAnnotations(actions:AnnotationActions):AnnotationView{
 const i:Instance={actions,menu:createRef(),editor:createRef(),comment:createRef(),chip:createRef(),details:createRef(),store:createStore<State>(()=>({menuHidden:true,editorHidden:true,chipHidden:true,chipText:'',detailsHidden:true,expanded:false,excerpt:'',drafts:[],draftRevision:0,markers:[],markerRevision:0}))};
 flushSync(()=>registry.setState({instance:i}));
 return {menu:i.menu.current!,editor:i.editor.current!,comment:i.comment.current!,chip:i.chip.current!,details:i.details.current!,patch:patch=>{
  const old=i.store.getState();
  if(Object.entries(patch).every(([key,value])=>old[key as keyof AnnotationViewState]===value))return;
  flushSync(()=>i.store.setState(patch));
 },drafts:drafts=>flushSync(()=>i.store.setState(s=>({drafts,draftRevision:s.draftRevision+1}))),markers:markers=>{
  if(!markers.length&&!i.store.getState().markers.length)return;
  flushSync(()=>i.store.setState(s=>({markers,markerRevision:s.markerRevision+1})));
 }};
}
