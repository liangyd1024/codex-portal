export function handoffMessage(handoff,connected) {
  if(!handoff)return '';
  if(handoff.state==='checking')return '正在检查此会话能否交还…';
  if(handoff.state==='released')return '已结束网页使用。可在桌面端点击“重试”继续；草稿保留在此网页。';
  if(!connected)return '交还状态待确认。恢复连接后会继续检查，网页不会自动接管此会话。';
  if(handoff.state==='waiting'){
    const delay=handoff.unloadDelaySecs;
    const timing=Number.isFinite(delay)?`本引擎设为无订阅、无活动 ${delay} 秒后释放`:'释放时间取决于引擎设置，默认约 30 分钟';
    return '网页已退出此会话，正在等待引擎释放。'+timing+'；其他入口仍使用此会话时会继续等待。';
  }
  return '交还结果尚未确认。网页不会自动接管；请重试交还或明确选择在网页继续。';
}

export function createHandoffControls({endUse}) {
  const link=document.createElement('link');link.rel='stylesheet';link.href='/handoff.css';document.head.append(link);
  const button=document.createElement('button');button.type='button';button.id='handoff-thread';button.className='text-button handoff-button';button.textContent='交还桌面端';
  document.getElementById('takeover').after(button);
  const banner=document.createElement('div');banner.className='handoff-status';banner.hidden=true;banner.tabIndex=-1;banner.id='handoff-status';
  let current={},notice=null;
  const message=document.createElement('span');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='重试交还';
  const close=document.createElement('button');close.type='button';close.className='icon-button handoff-dismiss';close.textContent='×';close.setAttribute('aria-label','关闭交还提示');
  banner.append(message,retry,close);document.getElementById('connection-banner').after(banner);
  const run=()=>{
    if(current.running){notice={kind:'running',text:'当前任务正在运行，请在任务结束后再交还桌面端。你可以继续补充要求。'};controls.render(current);return;}
    notice=null;void endUse();
  };button.onclick=run;retry.onclick=run;
  close.onclick=()=>{notice=null;controls.render(current);if(!button.hidden&&button.checkVisibility?.())button.focus();else document.getElementById('message-input').focus();};
  const controls = {
    focus(){(banner.hidden?button:banner).focus();},
    showError(text){notice={kind:'error',text};controls.render(current);},
    render({id,context=id,owned,handoff,connected,supported,busy,archived,conflict,running=false}) {
      if(id!==current.id||context!==current.context||notice?.kind==='running'&&!running)notice=null;
      current={id,context,owned,handoff,connected,supported,busy,archived,conflict,running};
      button.hidden=!id||archived||(!owned&&!['unknown','checking'].includes(handoff?.state));
      button.disabled=!connected||!supported||busy||handoff?.state==='checking'||(!owned&&handoff?.state!=='unknown');
      button.textContent=busy||handoff?.state==='checking'?'正在检查…':handoff?.state==='unknown'?'重试交还':'交还桌面端';
      button.title=!supported?'当前引擎尚未核验交还能力，请重连后检查。':'只结束此会话的网页使用，其他会话继续运行。';
      banner.hidden=!id||(!notice&&!handoff);
      message.textContent=notice?.text||handoffMessage(handoff,connected);
      retry.hidden=notice?.kind!=='error'&&handoff?.state!=='unknown';retry.disabled=!connected||busy||running;
      close.hidden=!notice;banner.classList.toggle('error',notice?.kind==='error');
      banner.setAttribute('aria-busy',String(busy||handoff?.state==='checking'));
    },
  };
  return controls;
}
