export function usageLabel(usage) {
  const limits=usage?.rateLimits;
  const windows=[limits?.primary,limits?.secondary].filter(w=>Number.isFinite(w?.usedPercent));
  const label=w=>w.windowDurationMins===10080?'周':w.windowDurationMins===300?'5h':w.windowDurationMins?`${w.windowDurationMins}m`:'额度';
  const remaining=w=>Math.max(0,Math.min(100,100-w.usedPercent));
  return {text:windows.length?windows.map(w=>`${label(w)} ${remaining(w)}%`).join(' · '):'用量 —',
    detail:windows.length?windows.map(w=>`${label(w)}剩余 ${remaining(w)}%${Number.isFinite(w.resetsAt)?'，重置 '+new Date(w.resetsAt*1000).toLocaleString('zh-CN'):''}`).join('\n'):'暂时无法读取用量'};
}
export function identityLabel(account) {
  if(account?.type==='chatgpt')return {text:account.email?.trim()||'ChatGPT 账号',detail:account.email?.trim()?`ChatGPT 账号：${account.email.trim()}`:'ChatGPT 账号（未提供邮箱）'};
  if(account?.type==='apiKey')return {text:'API Key',detail:'API Key 登录（未提供 Key 标识）'};
  return {text:'',detail:''};
}
export function installAccountUsage({node,identityNode,api,connected,context}) {
  let lastContext,version=0,pending=false,lastRead=0;
  const showIdentity=(text='',detail='')=>{
    if(!identityNode)return;
    identityNode.hidden=!text;if(identityNode.textContent!==text)identityNode.textContent=text;identityNode.title=detail;identityNode.setAttribute('aria-label',detail||text);
  };
  const clear=()=>{node.hidden=true;node.textContent='';node.title='';node.setAttribute('aria-label','');showIdentity();};
  return async function refresh(force=false) {
    const key=context();
    // Forced refresh is also an identity boundary: retire any in-flight reply.
    if(force){version++;pending=false;lastRead=0;clear();}
    if(key!==lastContext||!connected()) {lastContext=key;version++;pending=false;lastRead=0;clear();}
    if(!connected()||pending||(!force&&Date.now()-lastRead<60000))return;
    const seq=version;pending=true;lastRead=Date.now();
    if(identityNode?.hidden)showIdentity('正在读取账号…');
    try {
      const usage=await api('/api/account/usage');
      if(seq!==version||key!==context()||!connected())return;
      if(usage.recovery){clear();showIdentity(usage.signedOut?'未登录':'引擎登录已失效',usage.recovery);return;}
      node.hidden=!usage.visible;
      const label=usage.visible?usageLabel(usage):{text:'',detail:''};node.textContent=label.text;node.title=label.detail;node.setAttribute('aria-label',label.detail);
      const identity=identityLabel(usage.account);showIdentity(identity.text,identity.detail);
    } catch {if(seq===version&&key===context()){clear();if(connected())showIdentity('账号信息暂不可用','稍后自动重试');}}
    finally {if(seq===version)pending=false;}
  };
}
