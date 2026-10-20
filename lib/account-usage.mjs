import {readLiveStatus} from './status-read.mjs';
export async function readAccountUsage(manager) {
  const rpc=manager.rpc,generation=manager.generation;
  const identity=await readLiveStatus(manager,'account/read',{refreshToken:false});
  if(identity.account?.type!=='chatgpt')return {visible:false};
  try {
    const usage=await readLiveStatus(manager,'account/rateLimits/read');
    if(manager.rpc!==rpc||manager.generation!==generation)throw new Error('连接已变化');
    return {visible:true,rateLimits:usage.rateLimitsByLimitId?.codex||usage.rateLimits};
  } catch {return {visible:true,unavailable:true};}
}
