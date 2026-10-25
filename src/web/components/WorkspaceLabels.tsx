import {createElement,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
export type WorkspaceLabelId='projects-heading'|'control-overview'|'breadcrumb-project'|'thread-title'|'welcome-footnote'|'thread-path'|'model-selection-note'|'composer-model-label'|'composer-hint'|'control-badge'|'control-note';
interface LabelView {text?:string;hidden?:boolean;title?:string;className?:string}
const store=createStore<Partial<Record<WorkspaceLabelId,LabelView>>>(()=>({}));
export function WorkspaceLabel({as,id,className,hidden,children,role}:{as:'span'|'p'|'h1'|'div';id:WorkspaceLabelId;className?:string;hidden?:boolean;children?:ReactNode;role?:string}){
 const view=useStore(store,s=>s[id]);
 return createElement(as,{id,role,className:view?.className??className,hidden:view?.hidden??hidden,title:view?.title},view?.text??children);
}
export function publishWorkspaceLabel(id:WorkspaceLabelId,patch:LabelView){
 const old=store.getState()[id]||{};
 if(Object.entries(patch).every(([key,value])=>old[key as keyof LabelView]===value))return;
 flushSync(()=>store.setState({[id]:{...old,...patch}}));
}
export function setWorkspaceText(id:WorkspaceLabelId,value:unknown){publishWorkspaceLabel(id,{text:value==null||value===''?'—':String(value)});}
