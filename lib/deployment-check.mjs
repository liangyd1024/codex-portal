// Only the deploying Codex turn on this machine is exempt from active checks.
// This never interrupts a turn or stops the target engine.
export function assertDeploymentIdle(status,{connectionId,connectionName=connectionId,localConnectionId,deployingThreadId,settledErrorThreadIds=new Set()}={}) {
  if(!status?.connection || !Array.isArray(status.controlledSessions) || !Array.isArray(status.pendingRequests))throw Error('无法核对网页服务状态，未执行部署。');
  if(status.pendingRequests.length || status.controlledSessions.some(t=>t.pendingRequests>0))throw Error(`连接 ${connectionName} 有待处理请求，请处理后再部署。`);
  if(['connecting','reconnecting'].includes(status.connection.state))throw Error(`连接 ${connectionName} 正在连接或重连，尚不能确认会话状态；未重启网页，请连接稳定后重试。`);
  const own=connectionId===localConnectionId && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(deployingThreadId||'') ? deployingThreadId : null;
  const blocking=status.controlledSessions.filter(t=>!['idle','notLoaded'].includes(t.status?.type) && (t.status?.type!=='systemError'||!settledErrorThreadIds.has(t.id)) && (t.id!==own||t.status?.type!=='active'));
  if(blocking.length)throw Error(`连接 ${connectionName} 有运行会话或状态待确认：${blocking.map(t=>t.name||t.id).join('、')}。尚未重启网页，请会话结束后重试。`);
  return own && status.controlledSessions.some(t=>t.id===own&&t.status?.type==='active') ? own : null;
}

// Evidence is read during this preflight, never inferred from an old UI status.
// This permits only a web restart, not an engine stop or a failed-turn retry.
export function isSettledErrorThread(detail,id){
  return detail?.thread?.id===id && detail.thread.status?.type==='systemError'
    && Array.isArray(detail.turns) && detail.turns.length>0
    && detail.turns.every(t=>['completed','interrupted','failed'].includes(t?.status)&&Number.isFinite(t.completedAt)&&t.completedAt>0)
    && Array.isArray(detail.pendingRequests) && detail.pendingRequests.length===0
    && !detail.goalError && (detail.goal===null||['completed','paused','blocked'].includes(detail.goal?.status))
    && [detail.queue,detail.backgroundTerminals].every(list=>Array.isArray(list?.data)&&list.data.length===0&&!list.nextCursor&&!list.error);
}
