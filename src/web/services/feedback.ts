import type {NativeTurn,NativeStatus} from '../../contracts/native';
interface ToastView {node:HTMLElement;update:(message:string)=>void;remove:()=>void}
interface ConfirmOptions {message:string;title:string;accept:string;danger:boolean;finish:(accepted:boolean)=>void}
interface FeedbackViews {
 toast:(region:HTMLElement,options:{message:string;error:boolean;dismiss:()=>void})=>ToastView;
 confirm:(options:ConfirmOptions)=>{close:()=>void};
}
let views:FeedbackViews|undefined;
export function configureFeedbackViews(value:FeedbackViews){views=value;}
const installed=()=>{if(!views)throw Error('提示视图未安装。');return views;};
interface ToastOptions {region:HTMLElement;make?:unknown;icon?:unknown;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout}
export function createToasts({region,setTimer=setTimeout,clearTimer=clearTimeout}:ToastOptions){
 const active=new Map<string,{view:ToastView;error:boolean;timer:ReturnType<typeof setTimeout>|undefined;restart:()=>void}>();
 return (message:string,error=false,_duration=3000,key=JSON.stringify([error,message]),{information=false}={})=>{
  if(!error&&!information){const previous=active.get(key);if(previous){clearTimer(previous.timer);previous.view.remove();active.delete(key);}return;}
  for(const [id,entry] of active)if(!entry.view.node.isConnected){clearTimer(entry.timer);active.delete(id);}
  const previous=active.get(key);
  if(previous?.view.node.isConnected&&previous.error===error){previous.view.update(message);previous.restart();return previous.view.node;}
  if(previous){clearTimer(previous.timer);previous.view.remove();}
  const anchor=region.ownerDocument?.activeElement as HTMLElement|null;
  const entry={view:null as unknown as ToastView,error,timer:undefined as ReturnType<typeof setTimeout>|undefined,restart(){clearTimer(entry.timer);entry.timer=setTimer(dismiss,3000);}};
  const dismiss=()=>{const focused=entry.view.node.contains?.(region.ownerDocument?.activeElement);clearTimer(entry.timer);entry.view.remove();if(active.get(key)===entry)active.delete(key);if(focused&&anchor?.isConnected)anchor.focus({preventScroll:true});};
  entry.view=installed().toast(region,{message,error,dismiss});active.set(key,entry);entry.restart();return entry.view.node;
 };
}
let confirmationOpen=false;
export function confirmAction(message:string,{title='确认操作',accept='确认',danger=false}={}){
 if(confirmationOpen)return Promise.resolve(false);
 confirmationOpen=true;
 return new Promise<boolean>(resolve=>{
  const anchor=document.activeElement as HTMLElement|null;let settled=false;
  const finish=(value:boolean)=>{if(settled)return;settled=true;view.close();confirmationOpen=false;if(anchor?.isConnected)anchor.focus({preventScroll:true});resolve(value);};
  const view=installed().confirm({message,title,accept,danger,finish});
 });
}
interface StopRequest {turnId:string|null|undefined;background:boolean;requesting:boolean}
export function createStopFeedback(){
 const pending=new Map<string,StopRequest>();
 const kind=(status:NativeStatus|undefined)=>typeof status==='object'?status?.type:status;
 return {
  begin(key:string,turnId:string|null|undefined,background=false){const request={turnId,background,requesting:true};pending.set(key,request);return request;},
  settle(key:string,request:StopRequest,caught?:unknown){
   if(pending.get(key)!==request)return;
   const error=caught as {status?:number;code?:string}|undefined;
   if(error?.status!>=400&&error?.status!<500&&!['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(error?.code!))pending.delete(key);
   else request.requesting=false;
  },
  observe(key:string,{confirmed,turns=[],status,background}:{confirmed:unknown;turns?:NativeTurn[];status?:NativeStatus;background?:string}){
   const request=pending.get(key);
   if(!request||request.requesting||!confirmed)return Boolean(request);
   const turn=turns.find(t=>t.id===request.turnId);
   const finished=turn&&['completed','interrupted','failed'].includes(kind(turn.status)!);
   const idle=kind(status)==='idle'&&!turns.some(t=>['inProgress','in_progress','running'].includes(kind(t.status)!));
   if(request.background?background==='idle':finished||idle)pending.delete(key);
   return pending.has(key);
  },
  has:(key:string)=>pending.has(key),
 };
}
const copyTimers=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
export async function copyText(text:string,{button,status,failure='无法自动复制。请选中文字后复制。'}:{button:HTMLButtonElement;status:HTMLElement;failure?:string}){
 if(button.disabled)return;
 clearTimeout(copyTimers.get(status));copyTimers.delete(status);
 button.disabled=true;status.textContent='正在复制…';
 try{await navigator.clipboard.writeText(text);status.textContent='已复制';copyTimers.set(status,setTimeout(()=>{copyTimers.delete(status);if(status.textContent==='已复制')status.textContent='';},2000));}
 catch{status.textContent=failure;}finally{button.disabled=false;}
}
