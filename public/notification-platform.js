export function notificationSupport(env=window) {
  const nav=env.navigator;
  const ios=/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform==='MacIntel' && nav.maxTouchPoints>1);
  const standalone=nav.standalone===true || env.matchMedia?.('(display-mode: standalone)').matches;
  if(!env.isSecureContext)return {supported:false,message:'系统通知需要安全连接，请使用 HTTPS 地址打开。'};
  if(ios && !standalone)return {supported:false,message:'iPhone / iPad 请先点浏览器的分享按钮 →「添加到主屏幕」，再从主屏幕图标打开，开启任务系统通知（需要 iOS 16.4 或更新版本）。'};
  if(!('Notification' in env) || (ios && !nav.serviceWorker))return {supported:false,message:'当前浏览器不支持系统通知，请更新系统或使用支持通知的浏览器。'};
  return {supported:true,worker:!!nav.serviceWorker};
}

export async function prepareNotificationWorker(nav=navigator) {
  await nav.serviceWorker.register('/notification-worker.js',{scope:'/'});
  let timer;
  try { return await Promise.race([nav.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('通知初始化超时，请重试')),10000);})]); }
  finally { clearTimeout(timer); }
}

export async function submitWorkerNotification(registration,title,options,{submitted=()=>{},failed=/** @type {(message:string)=>void} */(()=>{})}={}) {
  try { await registration.showNotification(title,options);submitted();return true; }
  catch(error){failed(error.message);return false;}
}
