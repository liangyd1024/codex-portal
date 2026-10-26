interface Detail {
 [key:string]:unknown;
 thread?:{id:string;[key:string]:unknown};
 desktop?:{receipts?:Record<string,{status?:string;[key:string]:unknown}>;[key:string]:unknown};
}
interface Dependencies {
 state:{desktopMode:boolean;detail:Detail|null;loadingDetail:boolean;drafts:Map<string,string>};
 sends:Record<string,{messageId:string;text:string;pictures?:{id:string|null;items:{id:string}[]}}>;
 acknowledgeAttachments?:(pictures:{id:string|null;items:{id:string}[]})=>void;
 reportView:()=>Promise<unknown>|null|undefined;
 recordError:(error:unknown)=>void;
 request:(path:string,options?:{headers:Record<string,string>})=>Promise<Detail>;
 input:()=>{value:string};resizeInput:()=>void;saveSends:()=>void;
 now:()=>number;host:()=>string;canDecompress:()=>boolean;
 applyPreview:(detail:Detail)=>void;turns:()=>unknown[];
 outputBases:(turns:unknown[])=>Map<string,{token:unknown}>;
 decode:(detail:Detail)=>Promise<Detail>;
 hydrate:(detail:Detail,bases:Map<string,{token:unknown}>)=>Detail;
 recordTiming:(value:string)=>void;defer:(run:()=>void,delay:number)=>unknown;refreshSoon:()=>void;
}
// Preserve raw records and preview/full-read ordering. This layer owns no DOM.
export function createDetailReader(deps:Dependencies){
 const {state}=deps;
 return async function readSelectedDetail(id:string,isCurrent:()=>boolean):Promise<Detail>{

  const viewReady=deps.reportView();
  viewReady?.catch(()=>{}); // A preview may finish after a failed view request.
  if(state.desktopMode){
    viewReady?.catch(e=>deps.recordError(e));
    const data=await deps.request('/api/desktop/threads/'+encodeURIComponent(id));if(data.thread!.id!==id)throw new Error('桌面会话已变化，请重新打开。');
    const pending=deps.sends[id];
    if(pending&&data.desktop?.receipts?.[pending.messageId]?.status==='accepted'){
      if(state.drafts.get(id)===pending.text){state.drafts.set(id,'');if(isCurrent()&&deps.input().value===pending.text){deps.input().value='';deps.resizeInput();}}
      if(pending.pictures)deps.acknowledgeAttachments?.(pending.pictures);
      delete deps.sends[id];deps.saveSends();
    }
    return data;
  }
  const cold=!state.detail,started=deps.now();let firstMs=null;
  if(!state.detail){
    const preview=await deps.request('/api/threads/'+encodeURIComponent(id)+'?preview=1&lazyTools=1');
    if(!isCurrent())return preview;
    state.loadingDetail=false;deps.applyPreview(preview);firstMs=deps.now()-started;
  }
  if(viewReady)await viewReady;
  if(!isCurrent())return state.detail||{};
  const bases=deps.outputBases(deps.turns());
  const versions=Object.fromEntries([...bases].slice(-50).map(([id,b])=>[id,b.token]));
  const encoding=(deps.canDecompress()?'?outputEncoding=gzip-base64':'?outputEncoding=plain')+(cold?'&fast=1':'')+'&lazyTools=1';
  const response=await deps.request('/api/threads/' + encodeURIComponent(id)+encoding,{headers:{'X-Output-Versions':JSON.stringify(versions)}}),received=deps.now();
  const result=deps.hydrate(await deps.decode(response),bases);
  if(cold&&isCurrent())deps.recordTiming(JSON.stringify({host:deps.host(),id,firstMs:Math.round(firstMs??0),networkMs:Math.round(received-started-(firstMs??0)),decodeMs:Math.round(deps.now()-received),completeMs:Math.round(deps.now()-started)}));
  if(cold)deps.defer(()=>{if(isCurrent()&&!state.desktopMode)deps.refreshSoon();},1000);
  return result;

 };
}
