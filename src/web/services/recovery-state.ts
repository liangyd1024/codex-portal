interface Failure {threadId?:string;message?:string}
// Background subscription recovery is summarized by status, never one toast per thread.
// Keep the stage check for events from a server that has not yet been upgraded.
export function notifyManagerError(error:{diagnosticOnly?:unknown;stage?:unknown}) {
  return !error.diagnosticOnly && !String(error.stage || '').startsWith('恢复会话订阅：');
}

export function recoveryMessage(failures:Failure[] = []) {
  const count = new Set(failures.map(item => item.threadId)).size;
  return `${count} 个会话暂未恢复网页接管。这是上次连接恢复的结果，不代表当前连接中断；其他会话可继续使用。打开对应会话可重试接管。`;
}

export function selectedRecoveryMessage(failures:Failure[] = [], selectedId:string|null) {
  const failure = selectedId && failures.find(item => item.threadId === selectedId);
  if (!failure) return '';
  return /no rollout found/i.test(failure.message || '')
    ? '当前会话未恢复：引擎找不到该会话的历史记录。连接正常；详情见“设置 → 连接诊断”。'
    : '当前会话暂未恢复网页接管，可重试接管。连接正常；详情见“设置 → 连接诊断”。';
}
