// Activity is presentation only, never permission to control another entrance.
export function activitySource(thread, {connected=true, webActive=false, now=Date.now()}={}) {
  if(!connected)return null;
  if(webActive)return 'web';
  const activity=thread?.activity;
  return activity?.state==='running'&&activity.source==='desktop'&&Number.isFinite(activity.observedAt)&&now-activity.observedAt>=0&&now-activity.observedAt<30000?'desktop':null;
}
export function activityIcon(source, icon) {
  const node=document.createElement('span');
  node.className='activity-icon activity-'+source;
  node.title=source==='desktop'?'桌面运行中':'网页运行中';
  node.setAttribute('role','img');node.setAttribute('aria-label',node.title);
  node.append(icon(source==='desktop'?'monitor':'globe'));
  return node;
}
