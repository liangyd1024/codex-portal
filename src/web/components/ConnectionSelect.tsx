import {useLayoutEffect,useRef} from 'react';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
import type {SelectOption} from '../../contracts/view';
interface View {options:SelectOption[];value?:string;disabled:boolean}
const store=createStore<{view:View;change?:(value:string)=>void}>(()=>({view:{options:[],disabled:false}}));
export function publishConnectionSelect(patch:Partial<View>){
 const view=store.getState().view;
 if(Object.entries(patch).every(([key,value])=>Object.is(view[key as keyof View],value)))return;
 flushSync(()=>store.setState({view:{...view,...patch}}));
}
export function installConnectionSelectAction(change:(value:string)=>void){store.setState({change});}
export function ConnectionSelect(){
 const view=useStore(store,s=>s.view),select=useRef<HTMLSelectElement>(null);
 // Preserve native empty/no-match selection without controlling navigation in React.
 useLayoutEffect(()=>{if(select.current&&view.value!==undefined)select.current.value=view.value;},[view.options,view.value]);
 return <select ref={select} id="connection-select" aria-label="选择连接" disabled={view.disabled}
  onChange={event=>store.getState().change?.(event.currentTarget.value)}>
  {view.options.map(option=><option key={option.value} value={option.value} title={option.title||undefined}>{option.label}</option>)}
 </select>;
}
