import {useLayoutEffect,useRef} from 'react';
import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
export type InspectorView='settings'|'mobile';
interface Navigation {
 select:((view:InspectorView)=>void)|null;
 selected:InspectorView;
 automations:(()=>unknown)|null;
 automationPressed:false|undefined;
}
const navigation=createStore<Navigation>(()=>({select:null,selected:'settings',automations:null,automationPressed:undefined}));
export function InspectorNavigation(){
 const select=useStore(navigation,s=>s.select),automations=useStore(navigation,s=>s.automations),nav=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const apply=()=>{const current=navigation.getState();for(const button of nav.current?.querySelectorAll('button')||[]){const pressed=button.dataset.view?button.dataset.view===current.selected:current.automationPressed;if(pressed===undefined)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',String(pressed));}};
  // Keep baseline native click timing; this component owns registration and cleanup.
  const buttons=[...nav.current?.querySelectorAll('button')||[]];
  for(const button of buttons)button.onclick=()=>{const view=button.dataset.view;if(view==='settings'||view==='mobile')select?.(view);else automations?.();};
  apply();const unsubscribe=navigation.subscribe(apply);
  return()=>{unsubscribe();for(const button of buttons)button.onclick=null;};
 },[select,automations]);
 if(!select)return null;
 return <nav ref={nav} className="inspector-nav" aria-label="工作区详情分类"><button type="button" data-view="settings">设置</button><button type="button" data-view="mobile">手机访问</button>{automations&&<button className="automations-nav" id="open-automations" type="button">定时任务</button>}</nav>;
}
export function installInspectorNavigation(select:(view:InspectorView)=>void){
 flushSync(()=>navigation.setState({select}));
 return (selected:InspectorView)=>navigation.setState(s=>({selected,automationPressed:s.automations?false:undefined}));
}
export function installAutomationNavigation(automations:()=>unknown){flushSync(()=>navigation.setState({automations}));}
