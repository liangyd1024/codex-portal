export function notificationSupport(env=window) {
  const nav=env.navigator;
  const ios=/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform==='MacIntel' && nav.maxTouchPoints>1);
  const standalone=nav.standalone===true || env.matchMedia?.('(display-mode: standalone)').matches;
  if(!env.isSecureContext)return {supported:false,message:'系统通知需要安全连接，请使用 HTTPS 地址打开。'};
  if(ios && !standalone)return {supported:false,message:'iPhone / iPad 请先点浏览器的分享按钮 →「添加到主屏幕」，再从主屏幕图标打开，开启任务系统通知（需要 iOS 16.4 或更新版本）。'};
  if(!('Notification' in env) || (ios && !nav.serviceWorker))return {supported:false,message:'当前浏览器不支持系统通知，请更新系统或使用支持通知的浏览器。'};
  return {supported:true,worker:!!nav.serviceWorker};
}

export const NOTIFICATION_WORKER_VERSION=9;
const preparingWorkers=new WeakMap();
export function prepareNotificationWorker(nav=navigator) {
  const container=nav.serviceWorker;
  if(preparingWorkers.has(container))return preparingWorkers.get(container);
  const operation=prepare(container).finally(()=>preparingWorkers.delete(container));
  preparingWorkers.set(container,operation);return operation;
}
async function prepare(container){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  const signal=abort.signal;
  const bounded=promise=>new Promise((resolve,reject)=>{
    const stopped=()=>reject(Error('通知接收器更新超时，请重试'));
    if(signal.aborted){stopped();return;}
    signal.addEventListener('abort',stopped,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stopped));
  });
  try{
    // ready resolves for any active worker, including an obsolete one. Register
    // the protocol URL in the SAME scope and wait for this registration instead.
    const registration=await bounded(container.register('/notification-worker.js?v='+NOTIFICATION_WORKER_VERSION,{scope:'/',updateViaCache:'none'}));
    for(let attempt=0;attempt<2;attempt++){
      const worker=registration.installing||registration.waiting||registration.active;
      if(!worker)throw Error('通知接收器未启动，请重试');
      if(worker.state!=='activated')await new Promise((resolve,reject)=>{
        const cleanup=()=>{worker.removeEventListener('statechange',check);signal.removeEventListener('abort',stopped);};
        const stopped=()=>{cleanup();reject(Error('通知接收器更新超时，请重试'));};
        const check=()=>{
          if(worker.state==='activated'){cleanup();resolve();}
          else if(worker.state==='redundant'){cleanup();reject(Error('通知接收器更新失败，请重试'));}
        };
        worker.addEventListener('statechange',check);signal.addEventListener('abort',stopped,{once:true});
        if(signal.aborted)stopped();else check();
      });
      const version=await new Promise((resolve,reject)=>{
        const channel=new MessageChannel();
        const cleanup=()=>{channel.port1.close();channel.port2.close();signal.removeEventListener('abort',stopped);};
        const stopped=()=>{cleanup();reject(Error('通知接收器无响应，请重试'));};
        channel.port1.onmessage=event=>{cleanup();resolve(event.data?.version);};
        signal.addEventListener('abort',stopped,{once:true});
        if(signal.aborted){stopped();return;}
        try{worker.postMessage({type:'rcm-push-version'},[channel.port2]);}catch(error){cleanup();reject(error);}
      });
      if(version===NOTIFICATION_WORKER_VERSION&&registration.active===worker)return registration;
      if(attempt===0)await bounded(registration.update());
    }
    throw Error('通知接收器仍是旧版本，更新未生效，请重试');
  }finally{clearTimeout(timer);}
}

export async function submitWorkerNotification(registration,title,options,{submitted=()=>{},failed=/** @type {(message:string)=>void} */(()=>{})}={}) {
  try { await registration.showNotification(title,options);submitted();return true; }
  catch(error){failed(error.message);return false;}
}
