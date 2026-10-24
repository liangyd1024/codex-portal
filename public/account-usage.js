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
