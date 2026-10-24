const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
const content=item=>(item.input||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
const icon=kind=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+({edit:'<path d="M5 4v10a4 4 0 0 0 4 4h10m-4-4 4 4-4 4"/>',clear:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/>'}[kind])+'</svg>';
export function installQueuedInputs({host,context,api,refresh,onError}) {
 const list=el('div','composer-queue');list.setAttribute('aria-label','排队消息');list.hidden=true;host.querySelector('form.composer').before(list);
 const dialog=el('dialog','composer-dialog queue-edit-dialog');dialog.setAttribute('aria-label','编辑排队消息');document.body.append(dialog);
 let signature='',busy=new Set(),serial=0,editing=null;const versions=new WeakMap(),drafts=new Map();
 const version=item=>{if(!versions.has(item))versions.set(item,++serial);return versions.get(item);};
 const key=c=>JSON.stringify([c.host,c.id]);
 const itemKey=(c,item)=>key(c)+':'+item.id;
 dialog.addEventListener('close',()=>{const previous=editing;editing=null;if(previous&&key(context())===previous.scope)list.querySelectorAll('.queue-edit').forEach(b=>{if(b.dataset.id===previous.id)b.focus();});});
 async function act(item,action){
  const c=context(),k=itemKey(c,item);if(busy.has(k)||!c.ready||!c.supported)return;busy.add(k);render();
  try{await api('/api/threads/'+encodeURIComponent(c.id)+'/queue-'+action,{method:'POST',body:{queuedSubmissionId:item.id}});drafts.delete(k);}
  catch(error){if(key(context())===key(c))onError(error);}
  finally{busy.delete(k);if(key(context())===key(c)){await refresh().catch(onError);signature='';render();}}
 }
 function edit(item){
  const c=context(),k=itemKey(c,item);if(!c.ready||!c.editable||busy.has(k))return;
  const draft=drafts.get(k)||{base:content(item),text:content(item)};drafts.set(k,draft);
  dialog.replaceChildren();const title=el('h2','','编辑排队消息'),form=el('form','composer-goal'),label=el('label','','消息内容'),area=el('textarea',''),feedback=el('p',''),actions=el('div','goal-edit-actions'),cancel=el('button','','取消'),submit=el('button','','保存');
  area.value=draft.text;area.rows=7;area.maxLength=100000;label.append(area);feedback.setAttribute('role','status');let reloading=false;const reload=el('button','','重新读取消息');reload.type='button';reload.onclick=async()=>{if(busy.has(k)||reloading)return;reloading=true;reload.disabled=submit.disabled=true;area.readOnly=true;try{await refresh();if(!same())return;const latest=context().queue?.data?.find(q=>q.id===item.id);if(!latest)throw Error('消息已离开队列，草稿已保留。');draft.base=content(latest);draft.text=draft.base;area.value=draft.text;feedback.textContent='已读取当前消息。';}catch(error){if(same())feedback.textContent=error.message;}finally{reloading=false;if(same()){reload.disabled=submit.disabled=false;area.readOnly=false;}}};cancel.type='button';submit.type='submit';cancel.onclick=()=>dialog.close();actions.append(reload,cancel,submit);form.append(label,feedback,actions);dialog.append(title,form);
  const session={scope:key(c),id:item.id};editing=session;
  const same=()=>editing===session&&key(context())===key(c)&&dialog.open;
  area.oninput=()=>{draft.text=area.value;};
  let composing=false;area.addEventListener('compositionstart',()=>{composing=true;});area.addEventListener('compositionend',()=>{composing=false;});
  form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.stopPropagation();});
  form.onsubmit=async e=>{
   e.preventDefault();if(composing||reloading||!same()||busy.has(k))return;
   const now=context();if(!now.ready||!now.editable){feedback.textContent='连接尚未恢复，草稿已保留。';return;}
   if(area.value===draft.base){drafts.delete(k);dialog.close();return;}
   busy.add(k);submit.disabled=true;reload.disabled=true;area.readOnly=true;feedback.textContent='正在保存…';form.setAttribute('aria-busy','true');render();
   try{
    await api('/api/threads/'+encodeURIComponent(c.id)+'/queue-update',{method:'POST',body:{queuedSubmissionId:item.id,text:area.value,expectedText:draft.base}});
    drafts.delete(k);if(same())dialog.close();if(key(context())===key(c))await refresh();
   }catch(error){if(same())feedback.textContent=error.message;}
   finally{busy.delete(k);if(same()){submit.disabled=false;reload.disabled=false;area.readOnly=false;form.setAttribute('aria-busy','false');}signature='';render();}
  };
  dialog.showModal();area.focus();
 }
 function render(){
  const c=context();if(editing&&(!c.visible||editing.scope!==key(c)))dialog.close();
  const items=c.visible?(c.queue?.data||[]):[],sig=JSON.stringify([key(c),items.map(version),c.ready,c.running,c.supported,c.editable,[...busy]]);
  if(sig===signature)return;signature=sig;list.replaceChildren();list.hidden=!items.length;
  for(const item of items){
   const row=el('div','composer-queue-row goal-toolbar'),editButton=el('button','goal-edit queue-edit'),text=el('span','composer-queue-text',content(item)||'图片或引用消息');
   editButton.type='button';editButton.dataset.id=item.id;editButton.title=content(item)||'图片或引用消息';editButton.setAttribute('aria-label','编辑排队消息：'+(content(item)||'图片或引用消息'));editButton.innerHTML=icon('edit');editButton.append(text);editButton.onclick=()=>edit(item);
   const guide=el('button','queue-guide',c.running?'引导':'发送'),remove=el('button','goal-clear');guide.type=remove.type='button';remove.innerHTML=icon('clear');remove.title='删除排队消息';remove.setAttribute('aria-label',remove.title);guide.title=c.running?'引导当前任务':'立即发送';guide.setAttribute('aria-label',guide.title);
   const pending=busy.has(itemKey(c,item));row.setAttribute('aria-busy',String(pending));guide.disabled=remove.disabled=!c.ready||!c.supported||pending;editButton.disabled=!c.ready||!c.editable||pending;
   guide.onclick=()=>act(item,'steer');remove.onclick=()=>act(item,'delete');row.append(editButton,remove,guide);list.append(row);
  }
 }
 return {render};
}
