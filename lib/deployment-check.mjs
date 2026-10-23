// Web restarts leave native turns running on every target.
// This never interrupts a turn or stops the target engine.
export function assertDeploymentIdle(status,{connectionId,connectionName=connectionId,localConnectionId,allowedPendingRequestKeys=new Set()}={}) {
  if(!status?.connection || !Array.isArray(status.controlledSessions) || !Array.isArray(status.pendingRequests))throw Error('无法核对网页服务状态，未执行部署。');
  const local=connectionId===localConnectionId;
  const allowedRequest=r=>local&&typeof r.key==='string'&&allowedPendingRequestKeys.has(r.key);
  if(status.pendingRequests.some(r=>!allowedRequest(r)) || status.controlledSessions.some(t=>t.pendingRequests>status.pendingRequests.filter(r=>r.threadId===t.id&&allowedRequest(r)).length))throw Error(`连接 ${connectionName} 有待处理请求，请处理后再部署。`);
  if(['connecting','reconnecting'].includes(status.connection.state))throw Error(`连接 ${connectionName} 正在连接或重连，尚不能确认会话状态；未重启网页，请连接稳定后重试。`);

  return null;
}
