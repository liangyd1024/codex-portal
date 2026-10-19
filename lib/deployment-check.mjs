// Only the deploying Codex turn on this machine is exempt from active checks.
// This never interrupts a turn or stops the target engine.
export function assertDeploymentIdle(status,{connectionId,localConnectionId,deployingThreadId}={}) {
  if(!status?.connection || !Array.isArray(status.controlledSessions) || !Array.isArray(status.pendingRequests))throw Error('无法核对网页服务状态，未执行部署。');
  if(status.pendingRequests.length || status.controlledSessions.some(t=>t.pendingRequests>0))throw Error(`连接 ${connectionId} 有待处理请求，请处理后再部署。`);
  if(['connecting','reconnecting'].includes(status.connection.state))throw Error(`连接 ${connectionId} 正在连接，请完成后再部署。`);
  const own=connectionId===localConnectionId && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(deployingThreadId||'') ? deployingThreadId : null;
  const blocking=status.controlledSessions.filter(t=>t.status?.type==='active' && t.id!==own);
  if(blocking.length)throw Error(`连接 ${connectionId} 有其他运行会话：${blocking.map(t=>t.id).join('、')}，请空闲后再部署。`);
  return own && status.controlledSessions.some(t=>t.id===own&&t.status?.type==='active') ? own : null;
}
