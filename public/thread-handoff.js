export function handoffMessage(handoff,connected) {
  if(!handoff)return '';
  if(handoff.state==='checking')return '正在检查此会话能否交还…';
  if(handoff.state==='released')return '已结束网页使用。可在桌面端点击“重试”继续；草稿保留在此网页。';
  if(!connected)return '交还状态待确认。恢复连接后会继续检查，网页不会自动接管此会话。';
  if(handoff.state==='waiting')return '网页已退出此会话，正在等待引擎释放。通常需要无订阅、无活动约 30 分钟；其他网页入口仍使用此会话时会继续等待。';
  return '交还结果尚未确认。网页不会自动接管；请重试交还或明确选择在网页继续。';
}

export function createHandoffControls({endUse}) {
  const link=document.createElement('link');link.rel='stylesheet';link.href='/handoff.css';document.head.append(link);
  const menu=document.createElement('details');menu.className='thread-actions';menu.id='thread-actions';
  const summary=document.createElement('summary');summary.className='icon-button';summary.setAttribute('aria-label','会话操作');summary.title='会话操作';summary.textContent='⋯';
  const panel=document.createElement('div');panel.className='thread-actions-panel';
  const button=document.createElement('button');button.type='button';button.id='handoff-thread';button.textContent='交还桌面端';
  const hint=document.createElement('p');hint.id='handoff-menu-hint';button.setAttribute('aria-describedby',hint.id);
  panel.append(button,hint);menu.append(summary,panel);document.getElementById('takeover').after(menu);
  const banner=document.createElement('div');banner.className='handoff-status';banner.hidden=true;banner.tabIndex=-1;banner.id='handoff-status';
  const message=document.createElement('span');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='重试交还';
  banner.append(message,retry);document.getElementById('message-form').before(banner);
  const run=()=>{menu.open=false;void endUse();};button.onclick=run;retry.onclick=run;
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();event.stopPropagation();}});
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
  let selected;
  return {
    focus(){(banner.hidden?summary:banner).focus();},
    render({id,owned,handoff,connected,supported,busy,archived,conflict}) {
      if(selected!==id){menu.open=false;selected=id;}
      menu.hidden=!id||archived||(!owned&&!['unknown','checking'].includes(handoff?.state));
      button.disabled=!connected||!supported||busy||handoff?.state==='checking'||(!owned&&handoff?.state!=='unknown');
      button.textContent=busy||handoff?.state==='checking'?'正在检查…':handoff?.state==='unknown'?'重试交还':'交还桌面端';
      hint.textContent=!supported?'当前引擎尚未核验交还能力，请重连后检查。':'只结束此会话的网页使用，其他会话继续运行。';
      banner.hidden=!id||(!handoff&&!conflict);
      message.textContent=handoffMessage(handoff,connected)||(conflict?'此会话仍在另一个入口中使用。请在原入口结束使用并等待释放，然后重试；其他会话无需关闭。':'');
      retry.hidden=handoff?.state!=='unknown';retry.disabled=!connected||busy;
      banner.setAttribute('aria-busy',String(busy||handoff?.state==='checking'));
    },
  };
}
