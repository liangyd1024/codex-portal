// Only the deploying Codex turn on this machine is exempt from active checks.
// This never interrupts a turn or stops the target engine.
export function assertDeploymentIdle(status,{connectionId,connectionName=connectionId,localConnectionId,deployingThreadId}={}) {
  if(!status?.connection || !Array.isArray(status.controlledSessions) || !Array.isArray(status.pendingRequests))throw Error('无法核对网页服务状态，未执行部署。');
  if(status.pendingRequests.length || status.controlledSessions.some(t=>t.pendingRequests>0))throw Error(`连接 ${connectionName} 有待处理请求，请处理后再部署。`);
  if(['connecting','reconnecting'].includes(status.connection.state))throw Error(`连接 ${connectionName} 正在连接或重连，尚不能确认会话状态；未重启网页，请连接稳定后重试。`);
  const own=connectionId===localConnectionId && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(deployingThreadId||'') ? deployingThreadId : null;
  const blocking=status.controlledSessions.filter(t=>!['idle','notLoaded'].includes(t.status?.type) && (t.id!==own||t.status?.type!=='active'));
  if(blocking.length)throw Error(`连接 ${connectionName} 有运行会话或状态待确认：${blocking.map(t=>t.name||t.id).join('、')}。尚未重启网页，请会话结束后重试。`);
  return own && status.controlledSessions.some(t=>t.id===own&&t.status?.type==='active') ? own : null;
}
