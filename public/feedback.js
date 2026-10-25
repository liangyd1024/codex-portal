// Operations only notify on failure. Explicitly requested information is separate.
export function createToasts({region,make,icon,setTimer=setTimeout,clearTimer=clearTimeout}) {
  const active=new Map();
  // Keep the legacy duration argument for callers; all floating tips expire after 3s.
  return (message,error=false,_duration=3000,key=JSON.stringify([error,message]),{information=false}={})=>{
    if(!error&&!information){const previous=active.get(key);if(previous){clearTimer(previous.timer);previous.node.remove();active.delete(key);}return;}
    for(const [id,entry] of active)if(!entry.node.isConnected){clearTimer(entry.timer);active.delete(id);}
    const previous=active.get(key);
    if(previous?.node.isConnected&&previous.error===error){previous.node.querySelector('p').textContent=message;previous.restart();return previous.node;}
    if(previous){clearTimer(previous.timer);previous.node.remove();}
    const node=make('div','toast'+(error?' error':''));node.setAttribute('role',error?'alert':'status');
    node.append(icon(error?'alert':'check'),make('p','',message));
    const anchor=region.ownerDocument?.activeElement;
    const entry={node,error,timer:null,restart(){clearTimer(entry.timer);entry.timer=setTimer(dismiss,3000);}};
    const dismiss=()=>{const focused=node.contains?.(region.ownerDocument?.activeElement);clearTimer(entry.timer);node.remove();if(active.get(key)===entry)active.delete(key);if(focused&&anchor?.isConnected)anchor.focus({preventScroll:true});};
    const close=make('button','icon-button');close.type='button';close.setAttribute('aria-label','关闭提示');close.append(icon('close'));close.onclick=dismiss;node.append(close);
    active.set(key,entry);region.append(node);entry.restart();return node;
  };
}

let confirmationOpen=false;
export function confirmAction(message,{title='确认操作',accept='确认',danger=false}={}) {
  if(confirmationOpen)return Promise.resolve(false);
  confirmationOpen=true;
  return new Promise(resolve=>{
    const anchor=document.activeElement,dialog=document.createElement('dialog');dialog.className='confirm-dialog';
    const heading=document.createElement('h2');heading.id='confirm-action-title';heading.textContent=title;
    const body=document.createElement('p');body.id='confirm-action-description';body.textContent=message;
    dialog.setAttribute('aria-labelledby',heading.id);dialog.setAttribute('aria-describedby',body.id);
    const actions=document.createElement('div');actions.className='dialog-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='取消';
    const ok=document.createElement('button');ok.type='button';ok.className=danger?'primary-button danger':'primary-button';ok.textContent=accept;
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();confirmationOpen=false;if(anchor?.isConnected)anchor.focus({preventScroll:true});resolve(value);};
    cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.onclose=()=>finish(false);
    actions.append(cancel,ok);dialog.append(heading,body,actions);document.body.append(dialog);dialog.showModal();cancel.focus();
  });
}

// Feedback for a pending stop request only; native snapshots remain authoritative.
export function createStopFeedback() {
  const pending=new Map();
  const kind=status=>status?.type||status;
  return {
    begin(key,turnId,background=false){const request={turnId,background,requesting:true};pending.set(key,request);return request;},
    settle(key,request,error){
      if(pending.get(key)!==request)return;
      if(error?.status>=400&&error.status<500&&!['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(error.code))pending.delete(key);
      else request.requesting=false;
    },
    observe(key,{confirmed,turns=/** @type {import('../src/contracts/native').NativeTurn[]} */([]),status,background}){
      const request=pending.get(key);
      if(!request||request.requesting||!confirmed)return Boolean(request);
      const turn=turns.find(t=>t.id===request.turnId);
      const finished=turn&&['completed','interrupted','failed'].includes(kind(turn.status));
      const idle=kind(status)==='idle'&&!turns.some(t=>['inProgress','in_progress','running'].includes(kind(t.status)));
      if(request.background?background==='idle':finished||idle)pending.delete(key);
      return pending.has(key);
    },
    has:key=>pending.has(key),
  };
}

const copyTimers=new WeakMap();
export async function copyText(text,{button,status,failure='无法自动复制。请选中文字后复制。'}) {
  if(button.disabled)return;
  clearTimeout(copyTimers.get(status));copyTimers.delete(status);
  button.disabled=true;status.textContent='正在复制…';
  try {
    await navigator.clipboard.writeText(text);
    status.textContent='已复制';
    copyTimers.set(status,setTimeout(()=>{copyTimers.delete(status);if(status.textContent==='已复制')status.textContent='';},2000));
  } catch { status.textContent=failure; }
  finally { button.disabled=false; }
}
