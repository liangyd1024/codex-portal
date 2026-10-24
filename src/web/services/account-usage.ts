import {usageLabel,identityLabel} from '../../../public/account-usage.js';
export interface AccountUsage {
 visible?:boolean;account?:{type?:string;email?:string|null}|null;
 recovery?:string;signedOut?:boolean;
 rateLimits?:{primary?:{usedPercent?:number;windowDurationMins?:number;resetsAt?:number}|null;secondary?:{usedPercent?:number;windowDurationMins?:number;resetsAt?:number}|null}|null;
}
export interface AccountLabel {hidden:boolean;text:string;title?:string;ariaLabel?:string}
export interface AccountView {usage:AccountLabel;identity:AccountLabel}
export function installAccountUsage({api,connected,context,publish}:{api:(path:string)=>Promise<AccountUsage>;connected:()=>boolean;context:()=>unknown;publish:(view:AccountView)=>void}){
 let lastContext:unknown,version=0,pending=false,lastRead=0;
 let view:AccountView={usage:{hidden:true,text:''},identity:{hidden:true,text:''}};
 const showIdentity=(text='',detail='')=>{view={...view,identity:{hidden:!text,text,title:detail,ariaLabel:detail||text}};publish(view);};
 const clear=()=>{view={usage:{hidden:true,text:'',title:'',ariaLabel:''},identity:{hidden:true,text:'',title:'',ariaLabel:''}};publish(view);};
 return async function refresh(force=false){
  const key=context();
  if(force){version++;pending=false;lastRead=0;clear();}
  if(key!==lastContext||!connected()){lastContext=key;version++;pending=false;lastRead=0;clear();}
  if(!connected()||pending||(!force&&Date.now()-lastRead<60000))return;
  const seq=version;pending=true;lastRead=Date.now();
  if(view.identity.hidden)showIdentity('正在读取账号…');
  try{
   const usage=await api('/api/account/usage');
   if(seq!==version||key!==context()||!connected())return;
   if(usage.recovery){clear();showIdentity(usage.signedOut?'未登录':'引擎登录已失效',usage.recovery);return;}
   const label=usage.visible?usageLabel(usage):{text:'',detail:''};
   view={...view,usage:{hidden:!usage.visible,text:label.text,title:label.detail,ariaLabel:label.detail}};
   const identity=identityLabel(usage.account);showIdentity(identity.text,identity.detail);
  }catch{if(seq===version&&key===context()){clear();if(connected())showIdentity('账号信息暂不可用','稍后自动重试');}}
  finally{if(seq===version)pending=false;}
 };
}
