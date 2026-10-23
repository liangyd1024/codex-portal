import {assertDeploymentIdle,isSettledErrorThread} from './deployment-check.mjs';
// Retry a brief settling/reconnection window. Never issue connect or any mutation.
export async function checkDeploymentEntrance({localConnectionId,deployingThreadId,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=4,onWaiting=()=>{}}){
 let own=null;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const read=async url=>{const response=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('无法核对网页服务状态，请稍后重试。');return response.json();};
   const connections=await read('http://127.0.0.1:4317/api/connections');
   if(!Array.isArray(connections.data)||!connections.data.some(c=>c.id===localConnectionId))throw Error('无法核对网页连接列表。');
   for(const {id,host} of connections.data){
    const response=await fetchImpl('http://127.0.0.1:4317/api/system/deployment-status?host='+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});
    // Bootstrap from older installed versions which do not expose the fresh read.
    let status=response.status===404?await read('http://127.0.0.1:4317/api/status?host='+encodeURIComponent(id)):response.ok?await response.json():null;
    const settledErrorThreadIds=new Set();
    if(response.ok&&status?.connection?.state==='connected'){
      const errors=status.controlledSessions?.filter(t=>t.status?.type==='systemError')||[];
      // Full detail reads history, goal, queue and terminals through the existing
      // read-only route. It also works before the newer web version is installed.
      await Promise.all(errors.map(async thread=>{
        const detail=await read('http://127.0.0.1:4317/api/threads/'+encodeURIComponent(thread.id)+'?host='+encodeURIComponent(id));
        if(isSettledErrorThread(detail,thread.id))settledErrorThreadIds.add(thread.id);
      }));
      // A turn or a request may have started while the evidence was being read.
      if(errors.length)status=await read('http://127.0.0.1:4317/api/system/deployment-status?host='+encodeURIComponent(id));
    }
    const result=assertDeploymentIdle(status,{connectionId:id,connectionName:host?.alias||id,localConnectionId,deployingThreadId,settledErrorThreadIds});if(result)own=result;
   }
   return own;
  }catch(error){if(attempt===attempts-1)throw error;await onWaiting(error.message);await wait(2000);}
 }
}
