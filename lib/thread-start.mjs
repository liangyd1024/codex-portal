// Resolve account routing before any creation mutation. Failed reads are safe to
// retry; thread/start is never retried because its outcome may be unknown.
export const routingTimeout = error => /workspace routing discovery timed out/i.test(error?.message || '');
export async function prepareThreadStart(manager) {
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>rpc===manager.rpc&&generation===manager.generation&&rpc.connected;
  for(let attempt=0;attempt<2;attempt++){
    if(!current())throw Object.assign(new Error('连接已变化，尚未创建会话。请重连后重试。'),{status:409,code:'CREATE_NOT_STARTED'});
    try{
      await rpc.request('account/read',{refreshToken:false},{timeoutMs:10000});
      if(!current())throw Object.assign(new Error('连接已变化，尚未创建会话。请重连后重试。'),{status:409,code:'CREATE_NOT_STARTED'});
      return;
    }catch(error){
      if(!current())throw Object.assign(new Error('连接已变化，尚未创建会话。请重连后重试。'),{status:409,code:'CREATE_NOT_STARTED'});
      if(!routingTimeout(error)&&error.code!=='RPC_TIMEOUT')throw error;
      if(attempt===1)throw Object.assign(new Error('无法确认 Codex 工作区连接，尚未创建会话。草稿已保留，请稍后重试；若持续失败，请检查目标机器的 Codex 登录和网络。'),{status:503,code:'WORKSPACE_ROUTING_UNAVAILABLE'});
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
}
