import {useLayoutEffect} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface View {plan:boolean;goalPending:boolean;currentGoal:boolean;ephemeral:boolean;disabled:boolean;active:boolean;status:string}
interface Actions {mode:()=>void;cancelPlan:()=>void;cancelGoal:()=>void;goal:()=>void;pick:(kind:'skills'|'plugins',button:HTMLButtonElement)=>void}
interface Options {bar:HTMLElement;panel:HTMLElement;badges:HTMLElement;prefix:string;actions:Actions}
interface Instance extends Options {id:number;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Controls({bar,panel,badges,prefix,actions,store}:Instance){
 const v=useStore(store).view,planHidden=!v?.plan,goalHidden=!v?.goalPending||!!v?.currentGoal;
 useLayoutEffect(()=>{if(v)badges.hidden=planHidden&&goalHidden;},[badges,v,planHidden,goalHidden]);
 return <>{createPortal(<><button type="button" id={prefix+'execution-mode'} data-tool="execution-mode" aria-pressed={v?.plan??false} title={v?(v.plan?'退出计划模式':'计划：先制定方案'):undefined} disabled={v?(v.disabled||v.active):undefined} onClick={actions.mode}>计划</button><button type="button" id={prefix+'goal-settings'} data-tool="goal-settings" aria-pressed={v?Boolean(v.goalPending&&!v.currentGoal):undefined} disabled={v?(v.disabled||(!v.currentGoal&&v.active)||v.ephemeral):undefined} title={v?(v.ephemeral?'临时聊天不支持目标模式，请在主聊天使用。':v.currentGoal?'编辑当前目标内容':'用下一条输入设置目标'):undefined} onClick={actions.goal}>{v?.currentGoal?'编辑目标':'目标'}</button><button type="button" id={prefix+'skill-picker'} data-tool="skill-picker" disabled={v?.disabled} onClick={e=>actions.pick('skills',e.currentTarget)}>技能</button><button type="button" id={prefix+'plugin-picker'} data-tool="plugin-picker" disabled={v?.disabled} onClick={e=>actions.pick('plugins',e.currentTarget)}>插件</button></>,panel)}{createPortal(<><button type="button" className="composer-mode-badge" aria-label="退出计划模式" hidden={v?planHidden:undefined} disabled={v?(v.disabled||v.active):undefined} onClick={actions.cancelPlan}>计划 ×</button><button type="button" className="composer-mode-badge" aria-label={v?'取消本次目标设置':undefined} title={v?'发送时将输入内容设为目标，点击取消':undefined} hidden={v?goalHidden:undefined} disabled={v?.disabled} onClick={actions.cancelGoal}>{v?'目标 ×':''}</button></>,badges)}{createPortal(<span id={prefix+'composer-tools-status'} data-tool="composer-tools-status" role="status" hidden={v?!v.status:undefined}>{v?.status}</span>,bar)}</>;
}
export function ComposerControls(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Controls key={instance.id} {...instance}/>)}</>;}
export function installReactComposerControls(options:Options){
 const store=createStore<{view:View|null}>(()=>({view:null}));flushSync(()=>registry.setState({instances:[...registry.getState().instances,{...options,id:++sequence,store}]}));
 return {goalButton:options.panel.querySelector<HTMLButtonElement>('[data-tool="goal-settings"]')!,render(view:View){const old=store.getState().view;if(old&&Object.entries(view).every(([key,value])=>Object.is(old[key as keyof View],value)))return;flushSync(()=>store.setState({view}));}};
}
