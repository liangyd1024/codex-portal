import {processGroupStatus} from './activity.js';
const type = value => value?.type || value;
const running = value => ['inProgress','in_progress','running'].includes(type(value));

// Labels describe native items only. Never parse shell text or rewrite events.
export function processSummary(turn, items, options = {}) {
  const categories = new Set(), integrations = new Set();
  const active = running(turn.status);
  const current = active && items.includes(turn.items?.at(-1));
  const nativeStatus = processGroupStatus(turn,items,options);
  let status = current || nativeStatus === '后台命令仍在运行' ? nativeStatus : '';
  const onlyReasoning = items.every(item => item.type === 'reasoning');
  const hasReasoning = items.some(item => item.type === 'reasoning' &&
    [...(item.summary || []),...(item.content || [])].some(part => String(typeof part === 'string' ? part : part.text || '').trim()));
  if (onlyReasoning && current) status = options.uncertain ? '状态未确认' : '正在思考';
  for (const item of items) {
    if (item.type === 'commandExecution') {
      const actions = item.commandActions?.length ? item.commandActions : [{type:'unknown'}];
      for (const action of actions) categories.add(({read:'read',listFiles:'list',search:'search'})[action.type] || 'command');
    } else if (item.type === 'fileChange') categories.add('edit');
    else if (item.type === 'webSearch') categories.add('web');
    else if (item.type === 'mcpToolCall') {
      categories.add('integration');
      // appName is a native display name. Tool ids and plugin ids are not names.
      const name = item.appContext?.appName?.trim();
      if (name) integrations.add(name);
    } else if (!['agentMessage','reasoning'].includes(item.type)) categories.add('tool');
  }
  const live = current && !!status;
  const labels = {read:live?'读取文件':'已读取文件',list:live?'浏览目录':'已浏览目录',
    search:live?'搜索文件':'已搜索文件',edit:live?'修改文件':'已修改文件',
    web:live?'搜索网页':'已搜索网页',command:live?'运行命令':'运行了命令',
    integration:(live?'使用':'已使用') + (integrations.size?' '+[...integrations].join('、')+' ':'') + '集成',
    tool:live?'调用工具':'调用了工具'};
  // Category order is stable; result status belongs to each original detail.
  const order = ['read','list','search','edit','web','integration','tool','command'];
  const label = order.filter(key=>categories.has(key)).map(key=>labels[key]).join('') ||
    (onlyReasoning ? (status || '思考摘要') : '处理过程');
  const icon = categories.has('integration') ? 'integration' : categories.has('read') || categories.has('list') || categories.has('search') ? 'book' : categories.has('edit') ? 'file' : 'process-terminal';
  return {label,icon,status:onlyReasoning?'':status,failed:false,
    hidden:onlyReasoning && !hasReasoning && !current};
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
  const chevron = icon('chevron','chevron'); chevron.classList.add('process-chevron'); summary.append(chevron);
  return summary;
}
