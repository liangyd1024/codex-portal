export interface PairingView {formHidden:boolean;retryHidden:boolean;pending:boolean;busy?:boolean;button:string;status:string}
interface Options {
 input:Pick<HTMLInputElement,'value'|'setCustomValidity'|'reportValidity'|'focus'>;
 publish:(patch:Partial<PairingView>)=>void;
 fetch:typeof fetch;reload:()=>void;
 document:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;
 window:Pick<Window,'addEventListener'|'removeEventListener'>;
}
export const initialPairingView:PairingView={formHidden:true,retryHidden:true,pending:false,button:'配对并进入',status:'正在检查已有登录…'};
export const normalizePairingCode=(text:string)=>text.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/\s/g,'');
export function createPairingController({input,publish,fetch,reload,document,window}:Options){
 let pending=false,checking=false,authVersion=0;
 async function restoreLogin(){
  if(pending||checking||document.hidden)return;
  checking=true;publish({retryHidden:true});
  const version=authVersion,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('/api/access/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const data=await response.json();
   if(version!==authVersion||pending)return;
   if(response.ok&&data.local===false){publish({status:'已识别此设备，正在进入…'});reload();return;}
   if(response.status!==401||data.error?.code!=='PAIRING_REQUIRED')throw Error('暂时无法确认登录状态');
   publish({formHidden:false,status:'首次访问或登录已失效，请输入配对码。'});
  }catch{
   if(version!==authVersion||pending)return;
   publish({formHidden:false,retryHidden:false,status:'暂时无法连接工作台，请等待服务恢复后重新检查。已配对设备不需要因重启重新生成配对码。'});
  }finally{clearTimeout(timer);checking=false;}
 }
 async function submit(event:Pick<Event,'preventDefault'>){
  event.preventDefault();if(pending)return;
  const code=normalizePairingCode(input.value);
  if(!/^\d{6}$/.test(code)){input.setCustomValidity('请输入六位数字配对码。');input.reportValidity();return;}
  authVersion++;pending=true;publish({retryHidden:true,pending:true,busy:true,button:'正在配对…',status:'正在连接工作台…'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:controller.signal});
   const data=await response.json();
   if(!response.ok)throw Error(data.error?.message||'配对失败，请重新生成配对码后重试。');
   publish({status:'配对成功，正在进入…'});reload();
  }catch(caught){
   const error=caught as Error;
   publish({status:error.name==='AbortError'?'连接超时，请检查网络后重试。':error instanceof TypeError?'无法连接工作台，请检查手机网络与 Mac 服务后重试。':error.message,button:'重试配对'});
   input.focus({preventScroll:true});
  }finally{clearTimeout(timer);pending=false;publish({pending:false,busy:false});}
 }
 const inputChanged=()=>{input.value=normalizePairingCode(input.value);input.setCustomValidity('');};
 const paste=(event:Pick<ClipboardEvent,'clipboardData'|'preventDefault'>)=>{const code=normalizePairingCode(event.clipboardData?.getData('text')||'');if(/^\d{6}$/.test(code)){event.preventDefault();input.value=code;}};
 const visibility=()=>{if(!document.hidden)void restoreLogin();};
 function start(){
  for(const event of ['pageshow','focus','online'])window.addEventListener(event,restoreLogin);
  document.addEventListener('visibilitychange',visibility);void restoreLogin();
  return ()=>{for(const event of ['pageshow','focus','online'])window.removeEventListener(event,restoreLogin);document.removeEventListener('visibilitychange',visibility);};
 }
 return {restoreLogin,submit,inputChanged,paste,start};
}
