import {createElement,type HTMLAttributes} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
type Id='welcome'|'conversation'|'new-chat-page'|'messages'|'messages-scroller'|'project-list';
interface View {hidden?:boolean;busy?:boolean}
const store=createStore<Partial<Record<Id,View>>>(()=>({}));
export function WorkspaceRegion({as,id,...props}:HTMLAttributes<HTMLElement>&{as:'div'|'section'|'nav';id:Id}){
 const view=useStore(store,s=>s[id]);
 // Message children are owned by the verified renderer; changing region
 // attributes never supplies or reconciles transcript children through React.
 return createElement(as,{...props,id,hidden:view?.hidden??props.hidden,'aria-busy':view?.busy===undefined?props['aria-busy']:String(view.busy)},props.children);
}
export function publishWorkspaceRegion(id:Id,patch:View){const old=store.getState()[id]||{};if(Object.entries(patch).every(([key,value])=>old[key as keyof View]===value))return;flushSync(()=>store.setState({[id]:{...old,...patch}}));}
