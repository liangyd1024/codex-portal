const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
export function installQueuedInputs({host,context,api,refresh,onError}) {
 const list=el('div','composer-queue');list.setAttribute('aria-label','排队消息');list.hidden=true;host.prepend(list);
 let signature='',busy=new Set(),serial=0;const versions=new WeakMap();
 const version=item=>{if(!versions.has(item))versions.set(item,++serial);return versions.get(item);};
 const key=c=>JSON.stringify([c.host,c.id]);
 async function act(item,action){
  const c=context(),k=key(c)+':'+item.id;if(busy.has(k))return;busy.add(k);render();
  try{await api('/api/threads/'+encodeURIComponent(c.id)+'/queue-'+action,{method:'POST',body:{queuedSubmissionId:item.id}});}
  catch(error){onError(error);}
  finally{busy.delete(k);if(key(context())===key(c)){await refresh().catch(onError);signature='';render();}}
 }
 function render(){
  const c=context(),items=c.visible?(c.queue?.data||[]):[],sig=JSON.stringify([key(c),items.map(version),c.ready,c.running,c.supported,[...busy]]);
  if(sig===signature)return;signature=sig;list.replaceChildren();list.hidden=!items.length;
  for(const item of items){
   const row=el('div','composer-queue-row'),text=el('div','composer-queue-text',(item.input||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n')||'图片或引用消息');
   const imageCount=(item.input||[]).filter(p=>['image','localImage'].includes(p.type)).length;if(imageCount)text.append(el('span','subtle',' · '+imageCount+' 张图片'));
   const guide=el('button','text-button',c.running?'引导':'立即发送'),remove=el('button','icon-button','×');guide.type=remove.type='button';remove.setAttribute('aria-label','删除排队消息');
   guide.disabled=remove.disabled=!c.ready||!c.supported||busy.has(key(c)+':'+item.id);guide.onclick=()=>act(item,'steer');remove.onclick=()=>act(item,'delete');
   row.append(el('span','subtle','↳'),text,guide,remove);list.append(row);
  }
 }
 return {render};
}
