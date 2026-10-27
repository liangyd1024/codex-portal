import {prepareNotificationWorker} from '../../../public/notification-platform.js';
interface Dependencies {threadId?:()=>string|null;api:<T>(path:string,options?:{method?:string;body?:unknown})=>Promise<T>}
export function createPushSubscription({api,threadId}:Dependencies){
 let active=false;
 const bindingKey='rcm.push-binding-version';
 // Binding migration is independent of receiver releases. Diagnostic updates
 // must not rotate an already migrated subscription or discard pending pushes.
 const bindingVersion='5';
 let bindingVerified=false;
 function needsBindingRefresh(subscription:PushSubscription|null){
  if(bindingVerified||!subscription||!new URL(subscription.endpoint).hostname.endsWith('.push.apple.com'))return false;
  try{return window.localStorage.getItem(bindingKey)!==bindingVersion;}catch{return false;}
 }
 function rememberBinding(){
  bindingVerified=true;
  try{window.localStorage.setItem(bindingKey,bindingVersion);}catch{}
 }
 async function setEnabled(value:boolean){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){if(value)throw Error('当前浏览器不支持后台推送');return;}
  if(!value){const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager.getSubscription();if(subscription)await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:subscription.endpoint}});active=false;return;}
  // A verified subscription remains registered server-side during a receiver refresh.
  // Keep delivery ownership so foreground fallback cannot emit a duplicate.
  const registration=await prepareNotificationWorker();
  let subscription=await registration.pushManager.getSubscription();
  const {publicKey}=await api<{publicKey:string}>('/api/push/key');
  const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  // Older Apple subscriptions can outlive their receiver registration. Rebind
  // once after the verified receiver migration; never unregister the worker.
  if(needsBindingRefresh(subscription)){
    if(!await subscription!.unsubscribe())throw Error('旧通知订阅未能更新，请重试');
    subscription=null;
  }
  subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  rememberBinding();
  await api('/api/push/subscribe',{method:'POST',body:{subscription:subscription.toJSON()}});active=true;
  void reportReceiver(registration,subscription.endpoint).catch(()=>{});
 }
 async function reportReceiver(registration:ServiceWorkerRegistration,endpoint:string){
  let diagnostics:{version?:string|number;journal?:unknown[];capabilities?:string}={version:'unavailable'};
  if(registration.active)diagnostics=await new Promise<typeof diagnostics>(resolve=>{
    const channel=new MessageChannel();
    const finish=(value:typeof diagnostics)=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
    const timer=setTimeout(()=>finish({version:'timeout'}),5000);
    channel.port1.onmessage=event=>finish(event.data||{version:'unknown'});
    try{registration.active!.postMessage({type:'rcm-push-diagnostics'},[channel.port2]);}catch{finish({version:'failed'});}
  });
  try{await api('/api/push/trace',{method:'POST',body:{stage:'page-receiver',endpoint,version:'worker-'+diagnostics.version,visibility:document.visibilityState,journal:diagnostics.journal,capabilities:diagnostics.capabilities,userAgent:navigator.userAgent}});}catch{}
 }
 let testing:Promise<string>|undefined;
 function test(){
  if(testing)return testing;
  testing=runTest(threadId?.()||undefined).finally(()=>{testing=undefined;});return testing;
 }
 async function runTest(selectedThread?:string){
  const registration=await prepareNotificationWorker();
  const subscription=await registration.pushManager.getSubscription();if(!subscription)throw Error('请先开启后台通知');
  const testId=crypto.randomUUID();let finish:(value:string)=>void=()=>{};
  const receipt=new Promise<string>(resolve=>{finish=resolve;});
  const receive=(event:MessageEvent)=>{if(event.data?.type==='rcm-push-receipt'&&event.data.testId===testId)finish(event.data.error?'手机已收到推送，但系统显示失败：'+event.data.error:'手机已处理测试推送并调用系统显示，请检查通知中心。');};
  navigator.serviceWorker.addEventListener('message',receive);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await api('/api/push/test',{method:'POST',body:{endpoint:subscription.endpoint,testId,threadId:selectedThread}});
    timer=setTimeout(()=>finish('推送服务已接受，但 20 秒内未收到手机处理回执。系统兜底通知可能已显示；若仍未收到，请保留此结果继续排查。'),20000);
    return await receipt;
  }finally{clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',receive);}
 }

 return {setEnabled,test,active:()=>active};
}
