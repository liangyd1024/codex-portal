import {claimNotice,hasClaimedNotice} from './connection-state.js';

// Caller holds the origin-wide Web Lock. A failed attempt must remain retryable.
export async function deliverNotice(storage,key,send) {
  if(hasClaimedNotice(storage,key))return true;
  if(!await send())return false;
  claimNotice(storage,key);
  return true;
}

export function submitNotification(create,{shown=()=>{},failed=()=>{},timeoutMs=10000}={}) {
  return new Promise(resolve=>{
    let settled=false,timer;
    const finish=success=>{if(settled)return;settled=true;clearTimeout(timer);resolve(success);};
    try {
      const notification=create();
      notification.onshow=()=>{if(settled)return;shown();finish(true);};
      notification.onerror=()=>{if(settled)return;failed('浏览器报告发送失败');finish(false);};
      timer=setTimeout(()=>{if(settled)return;failed('浏览器未确认显示，请检查系统通知设置');finish(false);},timeoutMs);
    } catch(error){failed(error.message);finish(false);}
  });
}
