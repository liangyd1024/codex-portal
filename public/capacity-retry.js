export const CAPACITY_DELAYS=[10,30,120,300];
export function capacityFailure(turns=[]) {
  const last=turns.at(-1);
  if(last?.status!=='failed'||last.error?.codexErrorInfo!=='serverOverloaded')return null;
  let attempt=0;
  for(let i=turns.length-1;i>0;i--){
    const current=turns[i],prior=turns[i-1];
    if(current.items?.some(item=>item.type==='userMessage')||prior.status!=='failed'||prior.error?.codexErrorInfo!=='serverOverloaded')break;
    attempt++;
  }
  return {turnId:last.id,delay:CAPACITY_DELAYS[attempt]??null};
}
export class CapacityRetry {
  constructor({context,send,changed=()=>{},now=Date.now,storage}){Object.assign(this,{context,send,changed,now,storage});this.entries=new Map();this.key=null;}
  save(key,entry){this.entries.set(key,entry);try{this.storage?.setItem('rcm.capacity.'+key,JSON.stringify(entry));}catch{}}
  sync(){
    const c=this.context(),failure=capacityFailure(c.turns),key=failure?JSON.stringify([c.host,c.id,failure.turnId]):null;
    if(this.key&&this.key!==key){const old=this.entries.get(this.key);if(old?.phase==='waiting'){old.phase='paused';this.save(this.key,old);}}
    this.key=key;if(!key)return null;
    let entry=this.entries.get(key);
    if(!entry&&!c.ready)return {key,entry:{phase:'blocked'},failure,ready:false,seconds:0};
    if(!entry){try{entry=JSON.parse(this.storage?.getItem('rcm.capacity.'+key)||'null');}catch{}
      if(entry?.phase==='sending')entry.phase='uncertain';
      entry??={phase:failure.delay==null?'paused':'waiting',deadline:this.now()+(failure.delay??0)*1000};this.save(key,entry);
    }
    if(!c.ready&&entry.phase==='waiting'){entry.phase='paused';this.save(key,entry);}
    return {key,entry,failure,ready:c.ready,seconds:Math.max(0,Math.ceil((entry.deadline-this.now())/1000))};
  }
  tick(){const v=this.sync();this.changed(v);if(v?.ready&&v.entry.phase==='waiting'&&v.seconds===0)void this.retry(true);}
  cancel(){const v=this.sync();if(v){v.entry.phase='paused';this.save(v.key,v.entry);this.changed(this.sync());}}
  async retry(automatic=false){
    const v=this.sync();if(!v?.ready||['sending','sent','uncertain'].includes(v.entry.phase)||automatic&&v.entry.phase!=='waiting')return;
    const c=this.context();v.entry.phase='sending';delete v.entry.error;delete v.entry.errorCode;this.save(v.key,v.entry);this.changed(this.sync());
    try{await this.send(c,v.failure.turnId,automatic);v.entry.phase='sent';}
    catch(error){v.entry.phase=error.code==='OUTCOME_UNKNOWN'||!error.status?'uncertain':'paused';v.entry.error=error.message;v.entry.errorCode=error.code;}
    this.save(v.key,v.entry);this.changed(this.sync());
  }
}
export function installCapacityRetry({context,send,refresh,container,storage}){
  const panel=document.createElement('div');panel.className='capacity-retry';panel.hidden=true;
  const status=document.createElement('span');status.setAttribute('role','status');
  const retry=document.createElement('button');retry.type='button';retry.className='secondary-button';retry.textContent='立即重试';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='text-button';cancel.textContent='取消自动重试';
  const reload=document.createElement('button');reload.type='button';reload.className='text-button';reload.textContent='刷新状态';
  panel.append(status,retry,cancel,reload);container.prepend(panel);
  let refreshing=false;
  const controller=new CapacityRetry({context,send,storage,changed:v=>{
    panel.hidden=!v;if(!v)return;
    const phase=v.entry.phase;
    status.textContent=phase==='waiting'?`模型容量已满，${v.seconds} 秒后重试。`:phase==='blocked'?'正在确认会话状态…':phase==='sending'?'正在重试…':phase==='sent'?'已提交重试，正在同步…':phase==='uncertain'?'重试结果未确认，请刷新会话核对。':v.entry.error||'自动重试已暂停，可稍后重试或选择其他模型。';
    if(!v.ready&&!['sending','sent','uncertain'].includes(phase))status.textContent=context().unavailableReason||'正在确认会话状态，暂不能重试。';
    retry.disabled=refreshing||!v.ready||['sending','sent','uncertain'].includes(phase);cancel.hidden=phase!=='waiting';
    reload.hidden=!refresh||!['blocked','paused','uncertain'].includes(phase);reload.disabled=refreshing;reload.textContent=refreshing?'正在刷新…':'刷新状态';
  }});
  retry.onclick=()=>controller.retry();cancel.onclick=()=>controller.cancel();
  reload.onclick=async()=>{
    if(refreshing)return;refreshing=true;const key=controller.sync()?.key;controller.tick();
    try{await refresh();const v=controller.sync();if(v?.key===key&&v.ready&&['RETRY_THREAD_BUSY','RETRY_STATE_UNKNOWN','RETRY_STATE_CHANGED'].includes(v.entry.errorCode)){delete v.entry.error;delete v.entry.errorCode;controller.save(key,v.entry);}}catch{const v=controller.sync();if(v?.key===key){v.entry.error='状态刷新失败，请检查连接后重试。';controller.save(key,v.entry);}}
    finally{refreshing=false;controller.tick();}
  };
  let timer=setInterval(()=>controller.tick(),1000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
  window.addEventListener('pageshow',()=>{if(timer===null)timer=setInterval(()=>controller.tick(),1000);controller.tick();});
  return controller;
}
