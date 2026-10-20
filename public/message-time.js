import {groupTurnItems} from './message-body.js';

// Snapshot item times are milliseconds; turn times are Unix seconds.
export function userMessageTime(item) {
  const value = item.createdAtMs;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const label = new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).format(date);
  return {iso:date.toISOString(), label};
}

export function turnDurationLabel(turn) {
  const status = turn.status?.type || turn.status;
  if (!['completed','failed','interrupted','declined','systemError'].includes(status)) return null;
  let ms = turn.durationMs;
  if (ms == null && typeof turn.startedAt === 'number' && typeof turn.completedAt === 'number')
    ms = (turn.completedAt - turn.startedAt) * 1000;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return '用时 ' + (hours ? hours + '小时 ' : '') +
    (minutes ? minutes + '分 ' : '') + (seconds % 60) + '秒';
}

// Put the whole-turn duration beside the last process disclosure before the
// answer. Never repeat that total on each tool group or move original messages.
export function timedTurnGroups(turn) {
  const groups = groupTurnItems(turn), label = turnDurationLabel(turn);
  if (!label) return groups;
  let answer = groups.findIndex(g => g.type === 'message' && g.item.type === 'agentMessage' && g.item.phase === 'final_answer');
  if (answer < 0) answer = groups.findLastIndex(g => g.type === 'message' && g.item.type === 'agentMessage');
  if (answer < 0) answer = groups.length;
  const process = groups.findLastIndex((g, index) => g.type === 'process' && index < answer);
  if (process >= 0) groups[process].durationLabel = label;
  else groups.splice(answer, 0, {type:'duration', label});
  return groups;
}
