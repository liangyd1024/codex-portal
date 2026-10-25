import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
import type {BannerView} from '../services/connection-banner';
interface Indicators {ready:boolean;variant:string;label:unknown;name:unknown;address:unknown}
const store=createStore<{indicators:Indicators;banner:BannerView}>(()=>({indicators:{ready:false,variant:'',label:'未连接',name:'目标机器',address:'目标机器'},banner:{hidden:true,className:'connection-banner',text:''}}));
export function publishConnectionIndicators(patch:Partial<Indicators>,commit:(update:()=>void)=>void=flushSync){
 const current=store.getState().indicators;
 if(Object.entries(patch).some(([key,value])=>current[key as keyof Indicators]!==value))commit(()=>store.setState({indicators:{...current,...patch}}));
}
export function publishConnectionBanner(patch:Partial<BannerView>){
 const current=store.getState().banner;
 if(Object.entries(patch).some(([key,value])=>current[key as keyof BannerView]!==value))flushSync(()=>store.setState({banner:{...current,...patch}}));
}
const text=(value:unknown)=>value==null||value===''?'—':String(value);
export function HostName(){const name=useStore(store,state=>state.indicators.name);return <strong id="host-name" hidden>{text(name)}</strong>;}
export function BreadcrumbHost(){const name=useStore(store,state=>state.indicators.name);return <span id="breadcrumb-host">{text(name)}</span>;}
export function HostAddress(){const address=useStore(store,state=>state.indicators.address);return <span id="host-address">{text(address)}</span>;}
export function MachineDot(){const view=useStore(store,state=>state.indicators);return <span id="machine-dot" className={'connection-dot'+(view.ready?' '+view.variant:'')}/>;}
export function ConnectionPill(){const view=useStore(store,state=>state.indicators);const suffix=view.ready?' '+view.variant:'';return <span className={'connection-pill'+suffix} id="connection-pill"><span className={'connection-dot'+suffix}/><span id="connection-label">{text(view.label)}</span></span>;}
export function ConnectionBanner(){const view=useStore(store,state=>state.banner);return <div id="connection-banner" className={view.className} hidden={view.hidden} role="status">{view.text}</div>;}
