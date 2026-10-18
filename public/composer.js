export function installComposer({host,api,context,refresh,notify}) {
  const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);
  const bar=document.createElement('div');bar.className='composer-tools';
  bar.innerHTML='<label><span class="sr-only">执行模式</span><select id="execution-mode" aria-label="执行模式"><option value="default">执行</option><option value="plan">计划</option></select></label><label><span class="sr-only">权限</span><select id="access-mode" aria-label="权限"><option value="default">默认权限</option><option value="full">完全访问</option></select></label><button type="button" id="goal-settings">目标</button><button type="button" id="skill-picker">技能</button><button type="button" id="plugin-picker">插件</button><span id="composer-tools-status" role="status"></span>';
  const tools=document.createElement('details');tools.className='composer-options';
  const summary=document.createElement('summary');summary.textContent='工具';summary.setAttribute('aria-label','更多输入工具');const panel=document.createElement('div');panel.className='composer-options-panel';
  for(const button of bar.querySelectorAll('button'))panel.append(button);tools.append(summary,panel);bar.querySelector('[role=status]').before(tools);
  const position=()=>{if(!tools.open)return;const v=window.visualViewport,top=v?.offsetTop||0,height=v?.height||innerHeight;panel.style.maxHeight=Math.max(44,height-24)+'px';panel.style.top=Math.max(top+8,bar.getBoundingClientRect().top-panel.offsetHeight-8)+'px';};
  tools.addEventListener('toggle',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('resize',position);
  tools.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tools.open=false;summary.focus();}});
  document.addEventListener('pointerdown',e=>{if(!tools.contains(e.target))tools.open=false;});
  document.getElementById('message-form').before(bar);
  const mode=bar.querySelector('#execution-mode'),access=bar.querySelector('#access-mode'),status=bar.querySelector('#composer-tools-status');
  const preference='rcm.access.'+host;
  let saved;try{saved=localStorage.getItem(preference);}catch{}
  // The owner explicitly requested full access as the default for this workbench.
  access.value=saved==='default'?'default':'full';
  access.onchange=()=>{try{localStorage.setItem(preference,access.value);}catch{notify('权限已选择，但浏览器无法记住，下次打开请重新核对。',true);}render();};
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)):[]);let selected,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id);};
  mode.onchange=()=>{choice().mode=mode.value;save();render();};
  const dialog=document.createElement('dialog');dialog.className='composer-dialog';document.body.append(dialog);
  let opener,dialogVersion=0;
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  dialog.addEventListener('close',()=>{if(!dialog.open)opener?.focus();});
  function open(title,button){
    dialogVersion++;opener=button.closest('details')?.querySelector('summary')||button;tools.open=false;dialog.replaceChildren();
    const heading=document.createElement('h2');heading.textContent=title;
    const close=document.createElement('button');close.type='button';close.textContent='关闭';close.className='composer-dialog-close';close.onclick=()=>dialog.close();
    dialog.append(heading,close);dialog.showModal();return context();
  }
  const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
  async function picker(kind,button){
    const current=open(kind==='skills'?'选择技能':'已安装插件',button),id=current.id,version=dialogVersion;
    const pending=text('p','正在读取目标机器…');pending.setAttribute('role','status');dialog.append(pending);loading=true;
    try{
      const catalog=await api('/api/composer?cwd='+encodeURIComponent(current.cwd));
      if(context().id!==id||!dialog.open||version!==dialogVersion)return;
      pending.remove();
      const source=kind==='skills'?catalog.skills:catalog.plugins;
      if(source.error)throw Error(source.error);
      const entries=kind==='skills'?(source.data||[]).flatMap(e=>e.skills||[]):(source.marketplaces||[]).flatMap(e=>e.plugins||[]).filter(p=>p.installed);
      const seen=new Set(),items=entries.filter(e=>{const key=e.path||e.id;if(seen.has(key))return false;seen.add(key);return true;});
      const search=document.createElement('input');search.type='search';search.placeholder='搜索';search.setAttribute('aria-label','搜索'+(kind==='skills'?'技能':'插件'));dialog.append(search);
      const list=document.createElement('div');list.className='composer-catalog';dialog.append(list);
      if(!items.length)list.append(text('p',kind==='skills'?'此项目暂无技能。':'目标机器暂无已安装插件。'));
      for(const entry of items){
        const key=kind==='skills'?entry.path:entry.id,label=document.createElement('label');label.className='composer-catalog-item';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=choice()[kind].includes(key);checkbox.disabled=!entry.enabled;
        const body=document.createElement('span');body.append(text('strong',entry.interface?.displayName||entry.name),text('small',entry.description||entry.interface?.shortDescription||(!entry.enabled?'未启用':'')));
        checkbox.onchange=()=>{if(context().id!==id)return;const c=choice();c[kind]=checkbox.checked?[...c[kind],key]:c[kind].filter(v=>v!==key);save();render();};
        label.append(checkbox,body);list.append(label);
      }
      search.oninput=()=>{for(const row of list.querySelectorAll('label'))row.hidden=!row.textContent.toLowerCase().includes(search.value.toLowerCase());};
      dialog.append(text('p','选择后在下一条消息中使用。插件安装及账号授权请在 Codex 中管理。'));search.focus();
    }catch(e){if(context().id===id&&dialog.open&&version===dialogVersion){pending.remove();dialog.append(text('p','读取失败：'+e.message));const retry=text('button','重试');retry.type='button';retry.onclick=()=>{dialog.close();void picker(kind,button);};dialog.append(retry);}}
    finally{loading=false;}
  }
  bar.querySelector('#skill-picker').onclick=e=>void picker('skills',e.currentTarget);
  bar.querySelector('#plugin-picker').onclick=e=>void picker('plugins',e.currentTarget);
  bar.querySelector('#goal-settings').onclick=e=>{
    const current=open('目标',e.currentTarget),id=current.id,version=dialogVersion;
    if(current.goalError){const note=text('p','目标状态暂未读取，聊天内容仍可使用。'),retry=text('button','重新读取目标');retry.type='button';retry.onclick=async()=>{retry.disabled=true;try{await refresh();note.textContent=context().goalError?'仍未读取成功，请稍后重试。':'状态已更新，请重新打开目标设置。';}catch(error){note.textContent=error.message;}finally{retry.disabled=false;}};dialog.append(note,retry);return;}
    const form=document.createElement('form');form.className='composer-goal';
    const label=text('label','目标描述'),objective=document.createElement('textarea');objective.required=true;objective.value=current.goal?.objective||'';label.append(objective);
    const budgetLabel=text('label','Token 预算（可选）'),budget=document.createElement('input');budget.type='number';budget.min='1';budget.step='1';budget.value=current.goal?.tokenBudget||'';budgetLabel.append(budget);
    const feedback=text('p','设置后发送消息开始执行。');feedback.setAttribute('role','status');
    const save=text('button','保存目标');save.type='submit';form.append(label,budgetLabel,feedback,save);
    let saving=false;
    const update=async data=>{
      if(context().id!==id||saving)return;saving=true;
      for(const b of form.querySelectorAll('button'))b.disabled=true;
      feedback.textContent='正在保存…';
      try{await api('/api/threads/'+encodeURIComponent(id)+'/goal',{method:'POST',body:data});if(context().id!==id||version!==dialogVersion||!dialog.open)return;feedback.textContent='已保存';await refresh();if(version===dialogVersion)dialog.close();}
      catch(error){if(context().id===id)feedback.textContent='结果未确认：'+error.message+' 请刷新状态后核对。';}
      finally{saving=false;for(const b of form.querySelectorAll('button'))b.disabled=false;}
    };
    form.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();});
    form.onsubmit=event=>{event.preventDefault();void update({objective:objective.value,...(budget.value?{tokenBudget:Number(budget.value)}:{})});};
    if(current.goal){for(const [value,name] of [['paused','暂停目标'],['active','继续目标'],['complete','标记完成']]){const b=text('button',name);b.type='button';b.onclick=()=>void update({status:value});form.append(b);}}
    dialog.append(form);objective.focus();
  };
  function render(){
    const c=context();if(selected!==c.id){selected=c.id;if(dialog.open)dialog.close();}
    mode.value=choice().mode;const count=choice().skills.length+choice().plugins.length;summary.textContent='工具'+(count?' '+count:'');
    for(const control of bar.querySelectorAll('button,select'))control.disabled=!c.ready||c.busy||c.active;
    if(c.goalError){bar.querySelector('#goal-settings').textContent='目标（状态待确认）';bar.querySelector('#goal-settings').title='目标状态暂未读取，请刷新后重试。';}else{bar.querySelector('#goal-settings').textContent='目标';bar.querySelector('#goal-settings').title='设置目标';}
    status.textContent=[access.value==='full'?'命令无需逐次审批':'',choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:'',c.goalError?'目标状态暂不可用':c.goal?'目标：'+({active:'进行中',paused:'已暂停',complete:'已完成'}[c.goal.status]||c.goal.status):''].filter(Boolean).join(' · ');
  }
  return {render,setAccess:value=>{access.value=value;access.onchange();},access:()=>access.value,options:()=>({access:access.value,...choice()}),isLoading:()=>loading};
}
