import {assertDeploymentIdle} from './deployment-check.mjs';
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
    const status=response.status===404?await read('http://127.0.0.1:4317/api/status?host='+encodeURIComponent(id)):response.ok?await response.json():null;
    const result=assertDeploymentIdle(status,{connectionId:id,connectionName:host?.alias||id,localConnectionId,deployingThreadId});if(result)own=result;
   }
   return own;
  }catch(error){if(attempt===attempts-1)throw error;await onWaiting(error.message);await wait(2000);}
 }
}
