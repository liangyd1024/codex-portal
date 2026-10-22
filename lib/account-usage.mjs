import {authRecoveryMessage} from '../shared/account-state.js';
import {readLiveStatus} from './status-read.mjs';
export async function readAccountUsage(manager) {
  const rpc=manager.rpc,generation=manager.generation,accountRevision=manager.accountRevision||0;
  let identity;
  try {identity=await readLiveStatus(manager,'account/read',{refreshToken:false});}
  catch(error){const recovery=authRecoveryMessage(error);if(recovery){manager.setLoginRecovery?.(recovery);return {visible:false,account:null,unavailable:true,recovery};}throw error;}
  if(!identity.account&&identity.requiresOpenaiAuth===true){
    const recovery='目标引擎尚未登录。请在目标机器 Codex 中完成登录，再通过设置中的“重新加载登录”更新。';
    manager.setLoginRecovery?.(recovery);return {visible:false,account:null,signedOut:true,recovery};
  }
  if(manager.loginRecovery)return {visible:false,account:null,unavailable:true,recovery:manager.loginRecovery};
  // Only native identity fields needed for display may cross the HTTP boundary.
  // The API-key variant exposes a type only, not a key or a masked identifier.
  if(identity.account?.type==='apiKey')return {visible:false,account:{type:'apiKey'}};
  if(identity.account?.type!=='chatgpt')return {visible:false,account:null};
  const account={type:'chatgpt',email:typeof identity.account.email==='string'?identity.account.email:null};
  try {
    const usage=await readLiveStatus(manager,'account/rateLimits/read');
    if(manager.rpc!==rpc||manager.generation!==generation)throw new Error('连接已变化');
    // An account can change between identity and quota without a socket change.
    const latest=await readLiveStatus(manager,'account/read',{refreshToken:false});
    if(JSON.stringify(latest)!==JSON.stringify(identity)||(manager.accountRevision||0)!==accountRevision)throw Object.assign(new Error('账号已变化，请重新读取状态。'),{code:'ACCOUNT_CHANGED',status:409});
    return {visible:true,account,rateLimits:usage.rateLimitsByLimitId?.codex||usage.rateLimits};
  } catch(error) {
    manager.requireConnected();
    if(manager.rpc!==rpc||manager.generation!==generation||(manager.accountRevision||0)!==accountRevision||error.code==='ACCOUNT_CHANGED')throw error;
    const recovery=authRecoveryMessage(error);
    if(recovery){manager.setLoginRecovery?.(recovery);return {visible:false,account:null,unavailable:true,recovery};}
    return {visible:true,account,unavailable:true};
  }
}
