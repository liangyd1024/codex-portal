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

// Snapshot reads can lag behind SSE. Keep streamed text and terminal states.
export function mergeLiveTurns(current = [], incoming = []) {
  const terminal = value => ['completed','failed','interrupted'].includes(value);
  const mergeItem = (old, next) => {
    const merged = {...old, ...next};
    for (const key of ['text','aggregatedOutput','command','cwd']) {
      if (typeof old[key] === 'string' && (!next[key] || old[key].length > next[key].length)) merged[key] = old[key];
    }
    if(merged.aggregatedOutput===old.aggregatedOutput && old.aggregatedOutput!==next.aggregatedOutput)merged.outputToken=old.outputToken;
    else if(typeof next.aggregatedOutput==='string' && next.aggregatedOutput!==old.aggregatedOutput)merged.outputToken=next.outputToken;
    if (terminal(old.status) && !terminal(next.status)) merged.status = old.status;
    return merged;
  };
  const result = current.map(turn => ({...turn, items:[...(turn.items || [])]}));
  for (const turn of incoming) {
    const index = result.findIndex(old => old.id === turn.id);
    if (index < 0) { result.push(turn); continue; }
    const old = result[index], items = [...(old.items || [])];
    for (const item of turn.items || []) {
      const i = items.findIndex(value => value.id === item.id);
      if (i < 0) items.push(item); else items[i] = mergeItem(items[i], item);
    }
    const userTexts = new Set(items.filter(item => item.type === 'userMessage' && !item.localAccepted).map(item => (item.content || []).map(part => part.text || '').join('\n')));
    const confirmed = items.filter(item => !item.localAccepted || !userTexts.has((item.content || []).map(part => part.text || '').join('\n')));
    result[index] = {...old, ...turn, items:confirmed, status:terminal(old.status) && !terminal(turn.status) ? old.status : turn.status || old.status};
  }
  return result;
}

// Completion requires an explicit goal event; a completed turn is not a completed task.
export function taskNotice(method, params, {host, known}) {
  const request = params.request || params;
  const threadId = params.threadId || params.thread?.id || request.params?.threadId;
  if (!known || !threadId) return null;
  const notice = (identity,label,urgent=false) => ({key:JSON.stringify([host,threadId,...identity]),label,urgent});
  if (method === 'turn/completed') {
    if (params.turn?.status !== 'failed' || !params.turn.id) return null;
    return notice(['failure',params.turn.id],'执行失败',true);
  }
  if (method === 'manager/request') {
    if (request.id == null) return null;
    const labels = {question:'需要你回答',approval:'需要你审批',permissions:'需要你授权',elicitation:'需要你处理'};
    const itemId=request.params?.itemId;
    const identity=itemId?['request',request.params?.turnId,itemId,request.method]:['request',typeof request.id,request.id];
    return notice(identity,labels[request.kind] || '需要你处理',true);
  }
  if (method === 'thread/goal/updated') {
    const goal = params.goal;
    if (!goal || goal.createdAt == null) return null;
    const labels = {complete:'整个任务已完成',blocked:'任务受阻，需要你处理',usageLimited:'用量受限，需要你处理',budgetLimited:'预算已用完，需要你处理'};
    const label = labels[goal.status];
    if (!label) return null;
    // Usage updates and replayed terminal states must not cause another alert.
    return notice(['goal',goal.createdAt,goal.objective,goal.status],label,goal.status !== 'complete');
  }
  return null;
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
