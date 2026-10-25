interface Detail {controlled?:boolean;controlState?:string;handoff?:unknown}
interface Dependencies {
 state:{selectedId:string|null;selectionVersion:number;detail:Detail|null;drafts:Map<string,string>};
 api:(path:string,options:{method:'POST';body?:Record<string,unknown>;timeout?:number})=>Promise<Record<string,unknown>>;
 action:<T>(key:string,run:()=>Promise<T>)=>Promise<T|undefined>;
 feedback:(text:string)=>void;applyStatus:(status:Record<string,unknown>)=>void;
 renderStatus:()=>void;loadStatus:()=>Promise<unknown>;connected:()=>boolean;
 refreshWorkspace:()=>Promise<unknown>;renderThread:()=>void;usable:()=>boolean;
 newChatOpen:()=>boolean;applyDetail:(detail:Record<string,unknown>,resetModels:boolean)=>void;
 recordError:(error:unknown,stage:string)=>void;messageOf:(error:unknown)=>string;
 toast:(message:string,error:boolean,duration:number,key:string)=>void;
 input:()=>string;saveDrafts:()=>void;focusHandoff:()=>void;handoffError:(message:string)=>void;
}
export function createConnectionActions(d:Dependencies){
 const {state}=d;
 async function connectRemote(){
  d.feedback('');
  const success=await d.action('connect',async()=>{
   const data=await d.api('/api/connect',{method:'POST',body:{},timeout:150000});
   if(data.connection){d.applyStatus(data);d.renderStatus();}else await d.loadStatus();
   return true;
  });
  if(success){d.renderStatus();if(d.connected())d.refreshWorkspace().catch(e=>d.recordError(e,'sync'));}
 }
 async function disconnectRemote(){
  d.feedback('');
  return d.action('disconnect',async()=>{await d.api('/api/disconnect',{method:'POST'});await d.loadStatus();if(state.detail)state.detail.controlled=false;d.renderThread();});
 }
 async function takeoverThread(){
  if(!state.selectedId||!d.usable())return;
  const id=state.selectedId,selection=state.selectionVersion;
  const current=()=>id===state.selectedId&&selection===state.selectionVersion&&!d.newChatOpen();
  await d.action('takeover',async()=>{
   try{const detail=await d.api('/api/threads/'+encodeURIComponent(id)+'/takeover',{method:'POST'});if(current())d.applyDetail(detail,true);await d.loadStatus();}
   catch(error){
    d.recordError(error,'takeover');if(!current())return;
    if((error as {code?:string})?.code==='WRITER_CONFLICT'&&state.detail){state.detail.controlled=false;state.detail.controlState='conflict';d.renderThread();}
    d.toast(d.messageOf(error),true,8000,'takeover');
   }
  });
 }
 async function endThreadUse(){
  const id=state.selectedId,selection=state.selectionVersion;if(!id||!d.usable())return;
  state.drafts.set(id,d.input());try{d.saveDrafts();}catch{}
  await d.action('handoff:'+id,async()=>{
   try{
    const handoff=await d.api('/api/threads/'+encodeURIComponent(id)+'/handoff',{method:'POST',timeout:45000});
    if(id===state.selectedId&&selection===state.selectionVersion&&state.detail){state.detail.controlled=false;state.detail.handoff=handoff;state.detail.controlState='viewing';}
    await d.loadStatus();d.renderThread();if(id===state.selectedId&&selection===state.selectionVersion)d.focusHandoff();
   }catch(error){d.recordError(error,'handoff');await d.loadStatus().catch(()=>{});d.renderThread();if(id===state.selectedId&&selection===state.selectionVersion)d.handoffError(d.messageOf(error));}
  });
 }
 return{connectRemote,disconnectRemote,takeoverThread,endThreadUse};
}
