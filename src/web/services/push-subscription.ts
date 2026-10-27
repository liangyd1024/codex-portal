import {prepareNotificationWorker} from '../../../public/notification-platform.js';
interface Dependencies {threadId?:()=>string|null;api:<T>(path:string,options?:{method?:string;body?:unknown})=>Promise<T>}
export function createPushSubscription({api,threadId}:Dependencies){
 let active=false;
 async function setEnabled(value:boolean){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){if(value)throw Error('当前浏览器不支持后台推送');return;}
  if(!value){const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager.getSubscription();if(subscription)await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:subscription.endpoint}});active=false;return;}
  active=false;
  const registration=await prepareNotificationWorker();
  let subscription=await registration.pushManager.getSubscription();
  const {publicKey}=await api<{publicKey:string}>('/api/push/key');
  const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await api('/api/push/subscribe',{method:'POST',body:{subscription:subscription.toJSON()}});active=true;
  void reportReceiver(registration,subscription.endpoint).catch(()=>{});
 }
 async function reportReceiver(registration:ServiceWorkerRegistration,endpoint:string){
  let version='unavailable';
  if(registration.active)version=await new Promise<string>(resolve=>{
    const channel=new MessageChannel();
    const finish=(value:string)=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
    const timer=setTimeout(()=>finish('timeout'),5000);
    channel.port1.onmessage=event=>finish(String(event.data?.version||'unknown'));
    try{registration.active!.postMessage({type:'rcm-push-version'},[channel.port2]);}catch{finish('failed');}
  });
  try{await api('/api/push/trace',{method:'POST',body:{stage:'page-receiver',endpoint,version:'worker-'+version,visibility:document.visibilityState}});}catch{}
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
