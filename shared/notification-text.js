// Notification previews are excerpts of native content, never generated summaries.
export function notificationExcerpt(value, limit=120) {
  if(typeof value!=='string')return '';
  const text=value.slice(0,16000).replace(/```[\s\S]*?```/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').replace(/^[\s#>*-]+/gm,'').replace(/[`*_]/g,'').replace(/\s+/g,' ').trim();
  const chars=Array.from(text);return chars.length>limit?chars.slice(0,limit-1).join('')+'…':text;
}
export function notificationTitle(label,name,threadId) {
  const title=notificationExcerpt(name,40)||('会话 '+String(threadId||'').slice(0,8));
  return title+' · '+label;
}
export function notificationPreview(method,params) {
  if(method==='manager/notification')method=params.sourceMethod;
  if(method==='turn/completed'){
    const turn=params.turn||{};
    if(turn.status==='failed')return notificationExcerpt(turn.error?.message);
    const messages=(turn.items||[]).filter(item=>item.type==='agentMessage'&&typeof item.text==='string'&&item.phase!=='commentary');
    const last=messages.filter(item=>item.phase==='final_answer').at(-1)||messages.at(-1);
    return notificationExcerpt(last?.text);
  }
  if(method==='manager/request'){
    const request=params.request||params,p=request.params||{};
    return notificationExcerpt((p.questions||[]).map(q=>q.question||q.title||'').filter(Boolean).join('；')||p.message||p.reason);
  }
  if(method==='thread/goal/updated')return notificationExcerpt(params.goal?.objective);
  return '';
}
