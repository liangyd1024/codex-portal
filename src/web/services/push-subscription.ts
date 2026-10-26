import {prepareNotificationWorker} from '../../../public/notification-platform.js';
interface Dependencies {api:<T>(path:string,options?:{method?:string;body?:unknown})=>Promise<T>}
export function createPushSubscription({api}:Dependencies){
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
 async function test(){const registration=await prepareNotificationWorker(),subscription=await registration.pushManager.getSubscription();if(!subscription)throw Error('请先开启后台通知');await api('/api/push/test',{method:'POST',body:{endpoint:subscription.endpoint}});}
 return {setEnabled,test,active:()=>active};
}
