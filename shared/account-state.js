// Only recognized authentication failures get recovery advice. Keep the native
// error intact; a connection retry must never replay a failed user message.
export function authRecoveryMessage(error) {
  const message=typeof error==='string'?error:error?.message||'';
  if(!/invalid_api_key|incorrect API key provided|token_revoked|invalidated oauth token|access token could not be refreshed|refresh token (?:has|was|is)|refresh_token_(?:reused|expired|invalidated)|logged out or signed in to another account/i.test(message))return '';
  return '目标引擎登录已失效。请先在目标机器 Codex 中完成 ChatGPT 或 API Key 登录，再到「设置 → 目标机器连接 → 重新加载登录」。有运行任务时无法重新加载；恢复后请核对记录，再手动重发。';
}
