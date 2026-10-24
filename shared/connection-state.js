export function backgroundActivity(detail, {controlled = false, connected = false} = {}) {
  if (!controlled) return {state:'idle', terminals:[]};
  const result = detail?.backgroundTerminals;
  // Historical command items may remain inProgress after their process exits.
  // A successful live list, including an empty list, is authoritative.
  if (connected && !result?.error && Array.isArray(result?.data)) {
    return {state:result.data.length ? 'running' : 'idle', terminals:result.data};
  }
  const unconfirmed = result != null || (detail?.turns || []).some(turn =>
    (turn.items || []).some(item => item.type === 'commandExecution' && ['inProgress','in_progress','running'].includes(item.status?.type || item.status)));
  return {state:unconfirmed ? 'unknown' : 'idle', terminals:[]};
}

// HTTP replies and SSE notifications can arrive in a different order.
export function selectConnectionStatus(current, incoming, retiredInstances = new Set()) {
  if (!incoming) return current;
  if (current?.instanceId && incoming.instanceId) {
    if (current.instanceId === incoming.instanceId) {
      if (Number.isFinite(current.revision) && Number.isFinite(incoming.revision) && incoming.revision < current.revision) return current;
    } else {
      if (retiredInstances.has(incoming.instanceId)) return current;
      retiredInstances.add(current.instanceId);
    }
  }
  return incoming;
}

// Skill metadata is added by the engine and is absent from the optimistic echo.
export function userContentKey(content) {
  if(typeof content==='string')content=[{type:'text',text:content}];
  return JSON.stringify((content||[]).filter(p=>['text','image','localImage'].includes(p.type)).map(p=>p.type==='text'?['text',p.text||'']:[p.type,p.url||p.path||p.imageUrl||'']));
}

// Snapshot reads can lag behind SSE. Keep streamed text and terminal states.
export function mergeLiveTurns(current = [], incoming = []) {
  const terminal = value => ['completed','failed','interrupted'].includes(value);
  const mergeItem = (old, next) => {
    const merged = {...old, ...next};
    if(next.type==='mcpToolCall' && ((!next.detailsDeferred&&Object.hasOwn(next,'result')) ||
      (next.detailsDeferred&&terminal(old.status)&&!old.detailsDeferred&&Object.hasOwn(old,'result'))))delete merged.detailsDeferred;
    for (const key of ['text','aggregatedOutput','command','cwd']) {
      if (typeof old[key] === 'string' && (!next[key] || old[key].length > next[key].length)) merged[key] = old[key];
    }
    if(merged.aggregatedOutput===old.aggregatedOutput && old.aggregatedOutput!==next.aggregatedOutput)merged.outputToken=old.outputToken;
    else if(typeof next.aggregatedOutput==='string' && next.aggregatedOutput!==old.aggregatedOutput)merged.outputToken=next.outputToken;
    if (terminal(old.status) && !terminal(next.status)) merged.status = old.status;
    return merged;
  };
  const result = current.map(turn => ({...turn, items:[...(turn.items || [])]}));
  const knownIds=new Set(result.map(turn=>turn.id));
  for (let position=0;position<incoming.length;position++) {
    const turn=incoming[position];
    const index = result.findIndex(old => old.id === turn.id);
    if (index < 0) {
      // A latest-only preview is a suffix of the full page. Insert newly read
      // older turns before the next known turn, retaining newer SSE turns.
      const next=incoming.slice(position+1).find(value=>knownIds.has(value.id));
      const at=next?result.findIndex(old=>old.id===next.id):result.length;
      result.splice(at,0,turn);knownIds.add(turn.id);continue;
    }
    const old = result[index], items = [...(old.items || [])];
    for (const item of turn.items || []) {
      const i = items.findIndex(value => value.id === item.id);
      if (i < 0) items.push(item); else items[i] = mergeItem(items[i], item);
    }
    const userTexts = new Set(items.filter(item => item.type === 'userMessage' && !item.localAccepted).map(item => userContentKey(item.content)));
    const confirmed = items.filter(item => !item.localAccepted || !userTexts.has(userContentKey(item.content)));
    result[index] = {...old, ...turn, items:confirmed, status:terminal(old.status) && !terminal(turn.status) ? old.status : turn.status || old.status};
  }
  return result;
}

// Notify for each native terminal turn; never infer completion from message text.
export function taskNotice(method, params, {host, known}) {
  const request = params.request || params;
  const threadId = params.threadId || params.thread?.id || request.params?.threadId;
  if (!known || !threadId) return null;
  const notice = (identity,label,urgent=false) => ({key:JSON.stringify([host,threadId,...identity]),label,urgent});
  if (method === 'turn/completed') {
    const labels = {completed:'本次执行已完成',failed:'执行失败',interrupted:'本次执行已停止'};
    const label = labels[params.turn?.status];
    if (!label || !params.turn.id) return null;
    return notice([params.turn.status === 'failed' ? 'failure' : 'turn',params.turn.id],label,true);
  }
  if (method === 'manager/request') {
    if (request.id == null) return null;
    const labels = {asyncQuestion:'需要你回答',question:'需要你回答',approval:'需要你审批',permissions:'需要你授权',elicitation:'需要你处理'};
    const itemId=request.params?.itemId;
    const identity=itemId?['request',request.params?.turnId,itemId,request.method]:['request',typeof request.id,request.id];
    return notice(identity,labels[request.kind] || '需要你处理',true);
  }
  if (method === 'thread/goal/updated') {
    const goal = params.goal;
    if (!goal || goal.createdAt == null) return null;
    const labels = {blocked:'任务受阻，需要你处理',usageLimited:'用量受限，需要你处理',budgetLimited:'预算已用完，需要你处理'};
    const label = labels[goal.status];
    if (!label) return null;
    // Usage updates and replayed terminal states must not cause another alert.
    return notice(['goal',goal.createdAt,goal.objective,goal.status],label,goal.status !== 'complete');
  }
  return null;
}
export function hasClaimedNotice(storage,key) {
  let entries;
  try { entries=JSON.parse(storage.getItem('rcm.notifiedTasks.v2') || '[]'); } catch { return false; }
  return Array.isArray(entries) && entries.includes(key);
}
// Caller holds a Web Lock, shared by all tabs at this origin.
export function claimNotice(storage, key) {
  const name = 'rcm.notifiedTasks.v2';
  let entries;
  try { entries = JSON.parse(storage.getItem(name) || '[]'); } catch { entries = []; }
  if (!Array.isArray(entries)) entries = [];
  if (entries.includes(key)) return false;
  storage.setItem(name,JSON.stringify([...entries.slice(-999),key]));
  return true;
}
// Startup is background engine state, never conversation content. Clear any
// transient UI state retained by a caller; actual tool results render separately.
export function updateExtensionNotice(threads, event) {
  if (event.threadId) threads.delete(event.threadId);
}

export function renderExtensionNotice(notice, doc=document) {
  const node=doc.createElement('div');node.className='extension-notice';
  const text=doc.createElement('p');text.textContent=notice.summary;node.append(text);
  if(notice.status==='failed') {
    const hint=doc.createElement('p');hint.textContent='可以继续发送消息；需要该工具时，请检查目标机器的网络和 Codex 应用连接状态。';node.append(hint);
    const details=doc.createElement('details'),summary=doc.createElement('summary'),error=doc.createElement('pre');
    details.dataset.itemId='extension:'+notice.name;
    summary.textContent='查看错误详情';error.textContent=notice.detail;details.append(summary,error);node.append(details);
  }
  return node;
}
