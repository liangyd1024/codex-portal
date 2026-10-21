// Activity is presentation only, never permission to control another entrance.
export function activitySource(thread, {connected=true, webActive=false, now=Date.now()}={}) {
  if(!connected)return null;
  if(webActive)return 'web';
  const activity=thread?.activity;
  return activity?.state==='running'&&activity.source==='desktop'&&Number.isFinite(activity.observedAt)&&now-activity.observedAt>=0&&now-activity.observedAt<30000?'desktop':null;
}
export function activityIcon(source, icon) {
  const node=document.createElement('span');
  node.className='activity-icon activity-running activity-'+source;
  node.title=source==='desktop'?'桌面运行中':'网页运行中';
  node.setAttribute('role','img');node.setAttribute('aria-label',node.title);
  node.append(icon(source==='desktop'?'monitor':'globe'));
  return node;
}

// Creation identity is independent of the current execution entrance or control.
export function creationSource(thread) {
  if(thread?.originator==='remote_codex_manager')return 'web';
  if(thread?.originator==='Codex Desktop')return 'desktop';
  return 'unknown';
}
export function questionActivityIcon(icon) {
  const node=document.createElement('span');node.className='activity-icon activity-question';
  node.title='需要你回答';node.setAttribute('role','img');node.setAttribute('aria-label',node.title);
  node.append(icon('question'));return node;
}
export function threadSourceIcon(thread, runningSource, icon, needsAnswer=false) {
  if(needsAnswer)return questionActivityIcon(icon);
  const created=creationSource(thread);
  const source=runningSource || created;
  const node=document.createElement('span');
  node.className='activity-icon activity-'+source+(runningSource?' activity-running':'');
  node.title=({web:'网页端创建',desktop:'桌面端创建',unknown:'创建来源未知'})[created]+(runningSource?' · '+(runningSource==='web'?'网页端':'桌面端')+'正在运行':'');
  node.setAttribute('role','img');node.setAttribute('aria-label',node.title);
  node.append(icon(source==='desktop'?'monitor':source==='web'?'globe':'mark'));
  return node;
}

export function conversationActivity(thread, {connected=false, controlled=false, active=false, needsAnswer=false, background={state:'idle'}}={}) {
  if(connected&&needsAnswer)return {kind:'question',label:'需要你回答',detail:'请在下方选择或输入答案'};
  const source=activitySource(thread,{connected,webActive:controlled&&active});
  if(source)return {kind:'turn',source,label:source==='desktop'?'桌面端正在运行':'正在运行',detail:'持续同步最新进展…'};
  if(controlled&&connected&&background.state==='running')return {kind:'background',label:'本轮已结束',detail:`${background.terminals?.length || 1} 个后台命令仍在运行`,terminals:background.terminals || []};
  if(controlled&&background.state==='unknown')return {kind:'unknown',label:'后台命令状态待确认',detail:''};
  return null;
}
export function renderConversationActivity(node, activity, icon) {
  node.hidden=!activity;
  node.replaceChildren();
  if(!activity)return;
  if(activity.kind==='background') {
    const details=document.createElement('details');details.className='background-processes';
    const summary=document.createElement('summary');summary.textContent=activity.label+' · '+activity.detail;details.append(summary);
    const hint=document.createElement('p');hint.textContent='回复已结束，预览服务等后台命令可继续运行。展开查看命令；停止按钮仅停止这些后台命令。';details.append(hint);
    for(const terminal of activity.terminals){
      const entry=document.createElement('div');entry.className='background-process';
      const title=document.createElement('span');title.textContent='后台命令 '+terminal.processId;entry.append(title);
      const command=document.createElement('pre');command.textContent=terminal.command || '命令内容暂不可用';entry.append(command);details.append(entry);
    }
    node.append(details);return;
  }
  if(activity.kind==='question')node.append(questionActivityIcon(icon));
  else if(activity.kind==='turn')node.append(activityIcon(activity.source,icon));
  else {
    const badge=document.createElement('span');badge.className='activity-icon activity-unknown';
    badge.setAttribute('aria-hidden','true');badge.append(icon(activity.kind==='background'?'terminal':'alert'));node.append(badge);
  }
  for(const [cls,text] of [['running-label',activity.label],['running-detail',activity.detail]]){
    if(!text)continue;
    const span=document.createElement('span');span.className=cls;span.textContent=text;node.append(span);
  }
}

// Historical tool statuses are snapshots; only a live terminal proves continued execution.
export function processGroupStatus(turn, items, {background={state:'idle'}, uncertain=false}={}) {
  const status=value=>value?.type || value;
  const pending=items.some(item=>['inProgress','in_progress','running'].includes(status(item.status)));
  if(!pending)return '';
  if(uncertain)return '状态未确认';
  if(['completed','failed','interrupted'].includes(status(turn.status))){
    if(background.terminals?.some(terminal=>terminal.itemId && items.some(item=>item.id===terminal.itemId)))return '后台命令仍在运行';
    return background.state==='unknown'?'状态未确认':'';
  }
  return '执行中';
}
