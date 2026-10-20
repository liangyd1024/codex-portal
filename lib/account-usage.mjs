import {readLiveStatus} from './status-read.mjs';
export async function readAccountUsage(manager) {
  const rpc=manager.rpc,generation=manager.generation;
  const identity=await readLiveStatus(manager,'account/read',{refreshToken:false});
  // Only native identity fields needed for display may cross the HTTP boundary.
  // The API-key variant exposes a type only, not a key or a masked identifier.
  if(identity.account?.type==='apiKey')return {visible:false,account:{type:'apiKey'}};
  if(identity.account?.type!=='chatgpt')return {visible:false,account:null};
  const account={type:'chatgpt',email:typeof identity.account.email==='string'?identity.account.email:null};
  try {
    const usage=await readLiveStatus(manager,'account/rateLimits/read');
    if(manager.rpc!==rpc||manager.generation!==generation)throw new Error('连接已变化');
    return {visible:true,account,rateLimits:usage.rateLimitsByLimitId?.codex||usage.rateLimits};
  } catch(error) {
    manager.requireConnected();
    if(manager.rpc!==rpc||manager.generation!==generation)throw error;
    return {visible:true,account,unavailable:true};
  }
}
