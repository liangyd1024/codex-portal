import {processGroupStatus} from './activity.js';
const type = value => value?.type || value;
const running = value => ['inProgress','in_progress','running'].includes(type(value));

// Labels describe native items only. Never parse shell text or rewrite events.
export function processSummary(turn, items, options = {}) {
  let status = processGroupStatus(turn,items,options);
  const failed = items.some(item => ['failed','declined','error'].includes(type(item.status)) ||
    (item.type === 'commandExecution' && item.exitCode != null && item.exitCode !== 0));
  if (failed) status = '执行未成功';
  const labels = new Set();
  let icon = 'terminal';
  for (const item of items) {
    const done = type(item.status) === 'completed' && !(item.exitCode != null && item.exitCode !== 0);
    if (item.type === 'commandExecution') {
      const actions = item.commandActions?.length ? item.commandActions : [{type:'unknown'}];
      for (const action of actions) {
        const names = {read:['读取文件','已读取文件'],listFiles:['浏览目录','已浏览目录'],search:['搜索文件','已搜索文件']};
        labels.add(names[action.type]?.[done ? 1 : 0] || (done ? '运行了命令' : '运行命令'));
      }
    } else if (item.type === 'fileChange') labels.add(done ? '已修改文件' : '修改文件');
    else if (item.type === 'webSearch') labels.add(done ? '已搜索网页' : '搜索网页');
    else if (item.type === 'reasoning') {
      if (running(turn.status) && turn.items?.at(-1) === item && !options.uncertain && !status) status = '正在思考';
    } else if (item.type !== 'agentMessage') labels.add(item.tool || item.name || '工具调用');
  }
  if ([...labels].some(label => /文件|目录/.test(label))) icon = 'file';
  const label = [...labels].join(' · ') || (items.some(item => item.type === 'agentMessage') ? '处理过程' : '思考过程');
  return {label,icon,status,failed};
}

export function renderProcessSummary(description, {durationLabel,icon} = {}) {
  const summary = document.createElement('summary');
  summary.title = '展开或收起过程';
  summary.append(icon(description.icon));
  const label = document.createElement('span'); label.className = 'process-label';
  label.textContent = durationLabel || description.label; summary.append(label);
  if (description.status) {
    const status = document.createElement('span');
    status.className = 'process-status' + (description.failed ? ' error' : '');
    status.textContent = description.status; summary.append(status);
  }
  summary.append(icon('chevron','chevron'));
  return summary;
}
