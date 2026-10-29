import type {NativeDetail as Detail} from '../../contracts/native';
interface Dependencies {
 key:()=>string;
 desktop:(id:string)=>Promise<Detail>;
 resume:(id:string)=>Promise<Detail>;
 ready:()=>boolean;
 messageOf:(error:unknown)=>string;
}
// Resolve once per selection/connection. Only explicit retry may repeat a failed resume.
export function createThreadAccess(d:Dependencies){
 let attempted='',error='';
 async function resolve(id:string,detail:Detail,current:()=>boolean):Promise<Detail>{
  if(!current()||!d.ready()||detail.controlled||detail.recovering||detail.thread?.archived)return detail;
  const activity=detail.thread?.activity as {source?:string;state?:string}|undefined;
  if(activity?.source==='cli'&&activity.state==='running')return detail;
  if(detail.handoff&&detail.handoff.state!=='released')return detail;
  const key=d.key();
  if(attempted===key)return {...detail,accessError:error};
  attempted=key;error='';
  let desktop:Detail;
  try{desktop=await d.desktop(id);}
  catch(caught){if(current())error=d.messageOf(caught);return {...detail,accessError:d.messageOf(caught)};}
  if(!current())return detail;
  if(!d.ready()){attempted='';return detail;}
  if(desktop.thread?.id!==id){error='会话已变化，请刷新后重试。';return {...detail,accessError:error};}
  if(desktop.desktop?.available)return desktop;
  // A deliberate handoff must never be undone by browsing or refresh.
  if(detail.handoff){error=desktop.desktop?.error||'请恢复桌面连接后重试。';return {...desktop,handoff:detail.handoff,accessError:error};}
  try{
   const resumed=await d.resume(id);
   return current()?resumed:detail;
  }catch(caught){
   if(!current())return detail;
   error=(caught as {code?:string})?.code==='WRITER_CONFLICT'
    ?'此会话仍在其他入口使用，且暂时无法连接该入口。请在电脑端打开此会话后重试。'
    :d.messageOf(caught);
   return {...detail,controlled:false,accessError:error};
  }
 }
 return {resolve,reset(){attempted='';error='';}};
}
