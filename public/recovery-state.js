// Background subscription recovery is summarized by status, never one toast per thread.
// Keep the stage check for events from a server that has not yet been upgraded.
export function notifyManagerError(error) {
  return !error.diagnosticOnly && !String(error.stage || '').startsWith('恢复会话订阅：');
}

export function recoveryMessage(failures) {
  const count = new Set(failures.map(item => item.threadId)).size;
  return `已连接，${count} 个会话暂未恢复网页接管。其他会话可继续使用；可打开对应会话重试接管，错误详情见“设置 → 连接诊断”。`;
}
