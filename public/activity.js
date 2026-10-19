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
export function threadSourceIcon(thread, runningSource, icon) {
  const source=creationSource(thread);
  const node=document.createElement('span');
  node.className='activity-icon activity-'+source+(runningSource?' activity-running':'');
  node.title=({web:'网页端创建',desktop:'桌面端创建',unknown:'创建来源未知'})[source]+(runningSource?' · '+(runningSource==='web'?'网页端':'桌面端')+'正在运行':'');
  node.setAttribute('role','img');node.setAttribute('aria-label',node.title);
  node.append(icon(source==='desktop'?'monitor':source==='web'?'globe':'mark'));
  return node;
}
