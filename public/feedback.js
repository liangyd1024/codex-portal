// Keep one visible notification per message or explicitly named operation.
export function createToasts({region,make,icon,setTimer=setTimeout,clearTimer=clearTimeout}) {
  const active=new Map();
  return (message,error=false,duration=7500,key=JSON.stringify([error,message]))=>{
    for(const [id,entry] of active)if(!entry.node.isConnected){clearTimer(entry.timer);active.delete(id);}
    const previous=active.get(key);
    if(previous?.node.isConnected&&previous.error===error){previous.node.querySelector('p').textContent=message;previous.restart(duration);return previous.node;}
    if(previous){clearTimer(previous.timer);previous.node.remove();}
    const node=make('div','toast'+(error?' error':''));node.setAttribute('role',error?'alert':'status');
    node.append(icon(error?'alert':'check'),make('p','',message));
    const anchor=region.ownerDocument?.activeElement;
    const entry={node,error,timer:null,restart(ms){clearTimer(entry.timer);if(ms>0)entry.timer=setTimer(dismiss,ms);}};
    const dismiss=()=>{const focused=node.contains?.(region.ownerDocument?.activeElement);clearTimer(entry.timer);node.remove();if(active.get(key)===entry)active.delete(key);if(focused&&anchor?.isConnected)anchor.focus({preventScroll:true});};
    const close=make('button','icon-button');close.type='button';close.setAttribute('aria-label','关闭提示');close.append(icon('close'));close.onclick=dismiss;node.append(close);
    active.set(key,entry);region.append(node);entry.restart(duration);return node;
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
