export function usageLabel(usage) {
  const limits=usage?.rateLimits;
  const windows=[limits?.primary,limits?.secondary].filter(w=>Number.isFinite(w?.usedPercent));
  const label=w=>w.windowDurationMins===10080?'周':w.windowDurationMins===300?'5h':w.windowDurationMins?`${w.windowDurationMins}m`:'额度';
  const remaining=w=>Math.max(0,Math.min(100,100-w.usedPercent));
  return {text:windows.length?windows.map(w=>`${label(w)} ${remaining(w)}%`).join(' · '):'用量 —',
    detail:windows.length?windows.map(w=>`${label(w)}剩余 ${remaining(w)}%${Number.isFinite(w.resetsAt)?'，重置 '+new Date(w.resetsAt*1000).toLocaleString('zh-CN'):''}`).join('\n'):'暂时无法读取用量'};
}
export function installAccountUsage({node,api,connected,context}) {
  let lastContext,version=0,pending=false,lastRead=0;
  return async function refresh(force=false) {
    const key=context();
    if(key!==lastContext||!connected()) {lastContext=key;version++;pending=false;lastRead=0;node.hidden=true;node.textContent='';}
    if(!connected()||pending||(!force&&Date.now()-lastRead<60000))return;
    const seq=version;pending=true;lastRead=Date.now();
    try {
      const usage=await api('/api/account/usage');
      if(seq!==version||key!==context()||!connected())return;
      node.hidden=!usage.visible;
      const label=usageLabel(usage);node.textContent=label.text;node.title=label.detail;node.setAttribute('aria-label',label.detail);
    } catch {if(seq===version){node.hidden=true;node.textContent='';}}
    finally {if(seq===version)pending=false;}
  };
}
