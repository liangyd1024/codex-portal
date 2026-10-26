import {prepareNotificationWorker} from '../../../public/notification-platform.js';
interface Dependencies {threadId?:()=>string|null;api:<T>(path:string,options?:{method?:string;body?:unknown})=>Promise<T>}
export function createPushSubscription({api,threadId}:Dependencies){
 let active=false;
 async function setEnabled(value:boolean){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){if(value)throw Error('当前浏览器不支持后台推送');return;}
  const registration=await prepareNotificationWorker();
  let subscription=await registration.pushManager.getSubscription();
  if(!value){if(subscription)await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:subscription.endpoint}});active=false;return;}
  const {publicKey}=await api<{publicKey:string}>('/api/push/key');
  const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await api('/api/push/subscribe',{method:'POST',body:{subscription:subscription.toJSON()}});active=true;
 }
 let testing:Promise<string>|undefined;
 function test(){
  if(testing)return testing;
  testing=runTest(threadId?.()||undefined).finally(()=>{testing=undefined;});return testing;
 }
 async function runTest(selectedThread?:string){
  const registration=await prepareNotificationWorker();
  await registration.update();
  const worker=registration.installing||registration.waiting||registration.active;
  if(!worker)throw Error('通知接收器未启动，请重新打开应用');
  if(worker.state!=='activated')await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('statechange',check);reject(Error('通知接收器更新超时，请重新打开应用'));},10000);
    function check(){if(worker!.state==='activated'||worker!.state==='redundant'){clearTimeout(timer);worker!.removeEventListener('statechange',check);worker!.state==='activated'?resolve():reject(Error('通知接收器更新失败'));}}
    worker.addEventListener('statechange',check);check();
  });
  await new Promise<void>((resolve,reject)=>{
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('通知接收器版本未更新，请重新打开应用后重试'));},5000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.version===4?resolve():reject(Error('通知接收器版本不匹配'));};
    worker.postMessage({type:'rcm-push-version'},[channel.port2]);
  });
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
