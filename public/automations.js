const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
const button=(text,fn,cls='text-button')=>{const b=node('button',cls,text);b.type='button';b.onclick=fn;return b;};
const time=value=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export function scheduleLabel(rule){
  const fields=Object.fromEntries(String(rule||'').replace(/^RRULE:/,'').split(';').map(v=>v.split('=')));
  if(Object.keys(fields).some(k=>!['FREQ','INTERVAL','BYDAY','BYHOUR','BYMINUTE','BYSECOND'].includes(k))||fields.BYMINUTE?.includes(',')||(fields.INTERVAL&&fields.INTERVAL!=='1'&&['DAILY','WEEKLY'].includes(fields.FREQ)))return '自定义安排';
  if(fields.BYSECOND&&fields.BYSECOND!=='0')return '自定义安排';
  if(['MINUTELY','HOURLY'].includes(fields.FREQ)&&['BYDAY','BYHOUR','BYMINUTE'].some(k=>fields[k]))return '自定义安排';
  if(fields.FREQ==='MINUTELY')return `每 ${fields.INTERVAL||1} 分钟`;
  if(fields.FREQ==='HOURLY')return `每 ${fields.INTERVAL||1} 小时`;
  const at=fields.BYHOUR?.split(',').map(h=>h.padStart(2,'0')+':'+(fields.BYMINUTE||'0').padStart(2,'0')).join('、');
  if(fields.FREQ==='DAILY'&&at&&!fields.BYDAY)return '每天 '+at;
  if(fields.FREQ==='WEEKLY'&&at)return '每周 '+(fields.BYDAY||'').split(',').map(d=>({MO:'一',TU:'二',WE:'三',TH:'四',FR:'五',SA:'六',SU:'日'}[d]||d)).join('、')+' '+at;
  return '自定义安排';
}
export function installAutomations({api,onOpen,openSession,openThread,notify}){
  const page=node('section','automations-page');page.id='automations-page';page.hidden=true;
  document.querySelector('.main-panel').insertBefore(page,document.querySelector('.workspace-footer'));
  const header=node('div','automations-heading');header.append(node('h1','','定时任务'));
  const search=node('input','automations-search');search.type='search';search.placeholder='搜索任务';search.setAttribute('aria-label','搜索定时任务');
  const feedback=node('p','subtle');feedback.setAttribute('role','status');
  const list=node('div','automation-list');
  let snapshot=null,seq=0,loading=false,threadId=null,filter='all',signature='',activeDialog=null;
  const manage=async(prompt='')=>{try{if(!threadId){await choose(prompt);return;}await openSession(threadId,prompt);}catch(error){notify(error.message);}};
  const create=button('＋ 新建任务',()=>manage('请帮我创建一个定时任务。'),'secondary-button');
  const refresh=button('刷新',()=>load(),'secondary-button');header.append(refresh);
  const toolbar=node('div','automations-toolbar');const select=node('select');select.setAttribute('aria-label','筛选任务状态');
  for(const [value,label] of [['all','全部任务'],['ACTIVE','即将执行'],['PAUSED','已暂停']])select.add(new Option(label,value));
  select.onchange=()=>{filter=select.value;render();};search.oninput=render;
  toolbar.append(create,search,select);page.append(header,toolbar,feedback,list);
  function showTask(task,mode='view'){
    activeDialog?.close();
    const trigger=document.activeElement?.closest('.automation-row')?.querySelector('.automation-name')||document.activeElement;
    const dialog=node('dialog','automation-task-panel');activeDialog=dialog;
    dialog.setAttribute('aria-label',task.name);
    const heading=node('div','automation-task-heading');
    const close=button('×',()=>dialog.close(),'icon-button');close.setAttribute('aria-label','关闭任务详情');
    heading.append(node('h2','',task.name),close);
    const content=node('div','automation-task-content');
    content.append(node('p','subtle',(task.status==='PAUSED'?'已暂停':'即将执行')+' · '+scheduleLabel(task.rrule)));
    if(mode!=='view'){
      const editing=mode==='edit';
      content.append(node('h3','',editing?'编辑任务':'删除任务'),node('p','subtle','网页版通过已绑定的管理会话'+(editing?'编辑':'删除')+'此任务。该会话包含历史消息，与下方执行会话可能不同；打开后只填写草稿，发送后才执行。'));
      const prompt=editing?`请修改定时任务「${task.name}」（原生任务 ID：${task.id}）。`:`请删除定时任务「${task.name}」（原生任务 ID：${task.id}），只删除这一项。`;
      content.append(button(editing?'前往管理会话编辑':'前往管理会话删除',()=>{dialog.close();void manage(prompt);},'secondary-button'));
    }else content.append(button('编辑任务',()=>showTask(task,'edit'),'secondary-button'));
    content.append(node('h3','','任务内容'),node('p','automation-prompt',task.prompt),node('h3','','运行记录'));
    if(task.target_thread_id)content.append(button('打开执行会话',()=>{dialog.close();void openThread(task.target_thread_id);}));
    const runs=snapshot.runs.filter(run=>run.automation_id===task.id);
    if(task.last_run_at)content.append(node('p','subtle','最近原生触发：'+time(task.last_run_at)));
    if(!runs.length)content.append(node('p','subtle',task.kind==='heartbeat'?'此任务在原会话运行，结果请打开执行会话查看。':'暂无原生运行记录'));
    for(const run of runs)content.append(button(time(run.created_at)+' · '+({IN_PROGRESS:'执行中',PENDING_REVIEW:'待查看',ACCEPTED:'已查看',ARCHIVED:'已归档'}[run.status]||run.status),()=>{dialog.close();void openThread(run.thread_id);}));
    dialog.append(heading,content);document.body.append(dialog);dialog.showModal();close.focus();
    dialog.addEventListener('close',()=>{if(activeDialog===dialog)activeDialog=null;dialog.remove();if(!page.hidden)(trigger?.isConnected?trigger:create).focus();},{once:true});
  }
  function render(){
    list.replaceChildren();if(!snapshot)return;
    const items=snapshot.items.filter(t=>(filter==='all'||t.status===filter)&&t.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    items.sort((a,b)=>(a.next_run_at??Infinity)-(b.next_run_at??Infinity));
    if(!items.length)list.append(node('p','subtle','没有匹配的定时任务。'));
    for(const task of items){
      const card=node('article','automation-row');card.dataset.id=task.id;
      const title=button(task.name,()=>showTask(task), 'automation-name');
      const meta=node('p','subtle',(task.status==='PAUSED'?'已暂停':task.next_run_at?'下次 '+time(task.next_run_at):'等待原生调度更新')+' · '+scheduleLabel(task.rrule));
      const actions=node('details','automation-actions');
      const toggle=node('summary','','⋯');toggle.setAttribute('aria-label',task.name+'的操作');
      const menu=node('div','automation-menu');
      menu.append(button('编辑',()=>{actions.open=false;showTask(task,'edit');}),button('删除',()=>{actions.open=false;showTask(task,'delete');},'text-button danger'));
      actions.append(toggle,menu);
      actions.addEventListener('toggle',()=>{if(actions.open)for(const other of list.querySelectorAll('details[open]'))if(other!==actions)other.open=false;});
      actions.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();actions.open=false;toggle.focus();}});
      actions.addEventListener('focusout',event=>{if(!actions.contains(event.relatedTarget))actions.open=false;});
      card.append(title,meta,actions);list.append(card);
    }
  }
  async function load(){
    if(loading)return;loading=true;const version=++seq;refresh.disabled=true;feedback.textContent='正在同步原生定时任务…';
    try{const data=await api('/api/automations');if(version!==seq)return;snapshot=data;threadId=data.threadId;const next=JSON.stringify([data.items,data.runs]);if(signature!==next){render();signature=next;}feedback.textContent=data.pendingNativeRefresh?'部分任务等待桌面同步，请在桌面打开定时任务后刷新。':data.truncated?'当前显示最近 500 个任务。':'与目标机器 Codex 共用任务 · '+time(data.observedAt)+' 同步';}
    catch(error){if(version===seq)feedback.textContent='同步失败：'+error.message+' 已有列表保留。';}
    finally{loading=false;refresh.disabled=false;}
  }
  async function choose(prompt=''){
    const trigger=document.activeElement;
    const dialog=node('dialog','automation-picker');const title=node('h2','','选择桌面管理会话');const hint=node('p','subtle','先在目标机器的 Codex 桌面打开一条专用会话，再从这里选择。');
    const query=node('input');query.type='search';query.placeholder='按会话名称搜索';query.setAttribute('aria-label','搜索桌面会话');
    const choices=node('select');choices.size=7;choices.setAttribute('aria-label','桌面管理会话');
    const error=node('p','turn-error');error.setAttribute('role','status');let request=0,busy=false;
    const cancel=button('取消',()=>dialog.close(),'secondary-button');
    const confirm=button('使用此会话',async()=>{
      if(!choices.value||busy)return;busy=true;confirm.disabled=true;cancel.disabled=true;query.disabled=true;choices.disabled=true;error.textContent='正在确认桌面托管状态…';
      try{const result=await api('/api/automations/binding',{method:'POST',body:{threadId:choices.value}});threadId=result.threadId;dialog.close();await manage(prompt);}
      catch(e){error.textContent=e.message;}
      finally{busy=false;confirm.disabled=false;cancel.disabled=false;query.disabled=false;choices.disabled=false;}
    },'primary-button');
    dialog.append(title,hint,query,choices,error,cancel,confirm);document.body.append(dialog);dialog.showModal();query.focus();
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{request++;dialog.remove();if(page.hidden)return;(trigger?.isConnected?trigger:create).focus();},{once:true});
    async function find(){const version=++request;confirm.disabled=true;try{const result=await api('/api/automations/candidates?search='+encodeURIComponent(query.value));if(version!==request)return;choices.replaceChildren(...result.data.map(t=>new Option(t.name||t.title||t.id,t.id)));if(result.data.some(t=>t.id===threadId))choices.value=threadId;confirm.disabled=!choices.value;error.textContent=result.data.length?'':'没有匹配的会话。';}catch(e){if(version===request)error.textContent=e.message;}}
    let timer;query.oninput=()=>{clearTimeout(timer);timer=setTimeout(find,250);};choices.onchange=()=>confirm.disabled=!choices.value;await find();
  }
  return {get threadId(){return threadId;},get opened(){return !page.hidden;},
    open(){onOpen();page.hidden=false;document.querySelector('.main-panel').classList.add('automations-open');void load();},
    close(){activeDialog?.close();page.hidden=true;document.querySelector('.main-panel').classList.remove('automations-open');},refresh:load};
}
