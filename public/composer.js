import {installGoalToolbar} from './goal-toolbar.js';
import {validateGoalDraft,prepareGoalSubmission,reconcileGoalSelection} from './goal-submit.js';
import {installSkillSuggestions} from './skill-suggestions.js';
import {installInlineMentions,mentionRanges} from './inline-mentions.js';
export const WEB_ACCESS='full';

export function installComposer({host,api,context,refresh,notify,implementPlan,input=document.getElementById('message-input'),images=document.getElementById('add-images'),prefix=''}) {
  if(!document.querySelector('link[href="/composer.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);}
  const bar=document.createElement('div');bar.className='composer-tools';
  bar.innerHTML='<button type="button" id="execution-mode" aria-pressed="false">计划</button><button type="button" id="goal-settings">目标</button><button type="button" id="skill-picker">技能</button><button type="button" id="plugin-picker">插件</button><span id="composer-tools-status" role="status"></span>';
  for(const control of bar.querySelectorAll('[id]')){control.dataset.tool=control.id;control.id=prefix+control.id;}
  const tool=id=>bar.querySelector('[data-tool="'+id+'"]');
  const tools=document.createElement('details');tools.className='composer-options';
  const summary=document.createElement('summary');summary.textContent='＋';summary.setAttribute('aria-label','更多输入工具');const panel=document.createElement('div');panel.className='composer-options-panel';
  for(const button of bar.querySelectorAll('button'))panel.append(button);tools.append(summary,panel);bar.querySelector('[role=status]').before(tools);
  const badges=document.createElement('div');badges.className='composer-mode-badges';
  const planBadge=document.createElement('button');planBadge.type='button';planBadge.className='composer-mode-badge';planBadge.textContent='计划 ×';planBadge.setAttribute('aria-label','退出计划模式');
  const goalBadge=document.createElement('button');goalBadge.type='button';goalBadge.className='composer-mode-badge';
  badges.append(planBadge,goalBadge);tools.after(badges);
  const position=()=>{if(!tools.open)return;const v=window.visualViewport,top=v?.offsetTop||0,left=v?.offsetLeft||0,height=v?.height||innerHeight,width=v?.width||innerWidth;panel.style.maxHeight=Math.max(44,height-24)+'px';panel.style.maxWidth=Math.max(0,width-16)+'px';panel.style.right='auto';panel.style.left=Math.max(left+8,Math.min(summary.getBoundingClientRect().left,left+width-panel.offsetWidth-8))+'px';panel.style.top=Math.max(top+8,Math.min(summary.getBoundingClientRect().top-panel.offsetHeight-8,top+height-panel.offsetHeight-8))+'px';};
  tools.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(tools.open));position();});window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  tools.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tools.open=false;summary.focus();}});
  document.addEventListener('pointerdown',e=>{if(!tools.contains(e.target))tools.open=false;});
  input.form.querySelector('.composer-bottom').prepend(bar);
  images.classList.remove('icon-button');images.textContent='添加图片';panel.prepend(images);images.addEventListener('click',()=>{tools.open=false;});
  panel.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.tagName==='SELECT')return;const items=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),select:not(:disabled)')];const i=items.indexOf(document.activeElement);e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();});
  summary.addEventListener('click',e=>{e.preventDefault();if(summary.getAttribute('aria-disabled')==='true')return;tools.open=!tools.open;summary.setAttribute('aria-expanded',String(tools.open));position();});
  summary.addEventListener('keydown',e=>{if(summary.getAttribute('aria-disabled')==='true'){e.preventDefault();return;}if(e.key==='ArrowDown'){e.preventDefault();tools.open=true;summary.setAttribute('aria-expanded','true');position();panel.querySelector('button:not(:disabled)')?.focus();}});
  const mode=tool('execution-mode'),status=tool('composer-tools-status');
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)):[]);let selected,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id);};
  mode.onclick=()=>{choice().mode=choice().mode==='plan'?'default':'plan';choice().goalPending=false;save();render();tools.open=false;summary.focus();};
  planBadge.onclick=()=>{choice().mode='default';save();render();summary.focus();};
  goalBadge.onclick=()=>{choice().goalPending=false;save();render();summary.focus();};
  const references=()=>Array.isArray(choice().references)?choice().references.filter(r=>r&&['skills','plugins','threads'].includes(r.kind)&&typeof r.key==='string'&&typeof r.token==='string'&&r.token.length>1):[];
  const present=()=>mentionRanges(input.value,references());
  const syncReferences=()=>{const active=present();for(const kind of ['skills','plugins','threads'])choice()[kind]=[...new Set(active.filter(r=>r.kind===kind).map(r=>r.key))];};
  function insertReference(entry,kind='skills',range){
    const key=kind==='skills'?entry.path:entry.id;
    const token=(kind==='skills'?'$':'@')+(entry.name||key).replace(/\s+/gu,'-')+(kind==='threads'?'·'+key.slice(-8):'');
    const collision=present().find(r=>r.token===token&&r.key!==key);if(collision){notify('同名能力已在草稿中，请先删除原引用再选择。',true);return false;}
    choice().references=[...references().filter(r=>r.token!==token&&!(r.kind===kind&&r.key===key)),{kind,key,token}];
    const start=range?.start??input.selectionStart,end=range?.end??input.selectionEnd;
    input.setRangeText((start>0&&!/\s/u.test(input.value[start-1])?' ':'')+token+' ',start,end,'end');
    syncReferences();save();input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));render();return true;
  }
  const mirror=installInlineMentions(input,references);
  input.addEventListener('input',()=>{syncReferences();save();mirror.render();});
  const dialog=document.createElement('dialog');dialog.className='composer-dialog';document.body.append(dialog);
  let opener,dialogVersion=0;
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  dialog.addEventListener('close',()=>{if(!dialog.open&&document.activeElement!==input)opener?.focus();});
  function open(title,button){
    dialogVersion++;opener=button.closest('details')?.querySelector('summary')||button;tools.open=false;dialog.replaceChildren();
    const heading=document.createElement('h2');heading.textContent=title;
    const close=document.createElement('button');close.type='button';close.textContent='关闭';close.className='composer-dialog-close';close.onclick=()=>dialog.close();
    dialog.append(heading,close);dialog.showModal();return context();
  }
  const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
  async function picker(kind,button){
    dialog.classList.add('catalog-dialog');
    const current=open(kind==='skills'?'选择技能':'已安装插件',button),id=current.id,version=dialogVersion;
    const pending=text('p','正在读取目标机器…');pending.setAttribute('role','status');dialog.append(pending);loading=true;
    try{
      const catalog=await api('/api/composer?cwd='+encodeURIComponent(current.cwd)+'&kind='+kind);
      if(context().id!==id||context().cwd!==current.cwd||!dialog.open||version!==dialogVersion)return;
      pending.remove();
      const source=kind==='skills'?catalog.skills:catalog.plugins;
      if(source.error)throw Error(source.error);
      const entries=kind==='skills'?(source.data||[]).flatMap(e=>e.skills||[]):(source.marketplaces||[]).flatMap(e=>e.plugins||[]).filter(p=>p.installed);
      const seen=new Set(),items=entries.filter(e=>{const key=e.path||e.id;if(seen.has(key))return false;seen.add(key);return true;});
      const search=document.createElement('input');search.type='search';search.placeholder='搜索';search.setAttribute('aria-label','搜索'+(kind==='skills'?'技能':'插件'));dialog.append(search);
      const list=document.createElement('div');list.className='composer-catalog';dialog.append(list);
      const errors=kind==='skills'?(source.data||[]).flatMap(e=>e.errors||[]):source.marketplaceLoadErrors||[];
      if(errors.length){const warning=text('p','部分目录未能读取，列表可能不完整。已有选择仍保留。'),retry=text('button','重新读取');warning.setAttribute('role','status');retry.type='button';retry.onclick=()=>{dialog.close();void picker(kind,button);};dialog.append(warning,retry);}
      for(const key of choice()[kind])if(!seen.has(key))items.push({[kind==='skills'?'path':'id']:key,name:key,enabled:false,missing:true});
      if(!items.length)list.append(text('p',kind==='skills'?'此项目暂无技能。':'目标机器暂无已安装插件。'));
      for(const entry of items){
        const key=kind==='skills'?entry.path:entry.id,label=document.createElement('label');label.className='composer-catalog-item';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=present().some(r=>r.kind===kind&&r.key===key);checkbox.disabled=!entry.enabled&&!checkbox.checked;
        const body=document.createElement('span');body.append(text('strong',entry.interface?.displayName||entry.name),text('small',[entry.description||entry.interface?.shortDescription, !entry.enabled?(entry.missing?'目录中暂不可用，可取消选择后重试':(entry.disabledReason||'未启用')+'；已选项目可取消选择'):''].filter(Boolean).join(' · ')));
        checkbox.onchange=()=>{if(context().id!==id)return;if(checkbox.checked){dialog.close();insertReference(entry,kind);}else{for(const range of present().filter(r=>r.kind===kind&&r.key===key).reverse())input.setRangeText('',range.start,range.end,'end');syncReferences();save();render();input.dispatchEvent(new Event('input',{bubbles:true}));}checkbox.disabled=!entry.enabled&&!checkbox.checked;};
        label.dataset.search=[entry.name,entry.path,entry.id,body.textContent].filter(Boolean).join(' ').toLowerCase();label.append(checkbox,body);list.append(label);
      }
      const empty=text('p','没有匹配的'+(kind==='skills'?'技能':'插件')+'。');empty.hidden=true;empty.setAttribute('role','status');list.append(empty);
      search.oninput=()=>{let visible=0;for(const row of list.querySelectorAll('label')){row.hidden=!row.dataset.search.includes(search.value.trim().toLowerCase());if(!row.hidden)visible++;}empty.hidden=visible>0||!items.length;};
      dialog.append(text('p','选择后在下一条消息中使用。插件安装及账号授权请在 Codex 中管理。'));search.focus();
    }catch(e){if(context().id===id&&context().cwd===current.cwd&&dialog.open&&version===dialogVersion){pending.remove();const failure=text('p','暂时无法加载'+(kind==='skills'?'技能':'插件')+'，请重试。你的草稿已保留。');failure.setAttribute('role','status');dialog.append(failure);const details=document.createElement('details');details.append(text('summary','错误详情'),text('p',e.message));dialog.append(details);const retry=text('button','重试');retry.type='button';retry.onclick=()=>{dialog.close();void picker(kind,button);};dialog.append(retry);}}
    finally{loading=false;}
  }
  tool('skill-picker').onclick=e=>void picker('skills',e.currentTarget);
  tool('plugin-picker').onclick=e=>void picker('plugins',e.currentTarget);
  const goalButton=tool('goal-settings');
  goalButton.onclick=()=>{
    const c=context();
    if(c.ephemeral){notify('临时聊天不支持目标模式，请在主聊天设置目标。',true);return;}
    if(c.goalError){notify('目标暂未读取，请刷新后重试。',true);return;}
    if(c.goal){editGoal(goalButton);return;}
    const next=!choice().goalPending;
    choice().goalPending=next;
    if(next){choice().mode='default';delete choice().goalUncertain;}
    save();render();tools.open=false;input.focus();
  };
  let goalUpdating=false;
  function editGoal(button){
    const current=context();
    if(!current.goal||current.goalError){notify('目标暂未读取，请刷新后重试。',true);return;}
    dialog.classList.remove('catalog-dialog');
    const c=open('编辑目标',button),id=c.id,version=dialogVersion,selection=choice();
    const draft=selection.goalEdit||(selection.goalEdit={base:c.goal.objective,text:c.goal.objective});
    const form=document.createElement('form');form.className='composer-goal';
    const label=text('label','目标内容'),area=document.createElement('textarea');area.value=draft.text;area.required=true;area.maxLength=10000;area.rows=7;label.append(area);
    const feedback=text('p','');feedback.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='goal-edit-actions';
    const cancel=text('button','取消'),submit=text('button','保存');cancel.type='button';submit.type='submit';cancel.onclick=()=>dialog.close();
    let reloading=false;
    const reload=text('button','重新读取目标');reload.type='button';reload.hidden=!draft.uncertain&&draft.base===c.goal.objective;
    actions.append(reload,cancel,submit);form.append(label,feedback,actions);dialog.append(form);
    reload.onclick=async()=>{
      if(goalUpdating||reloading)return;reloading=true;reload.disabled=true;submit.disabled=true;area.readOnly=true;
      try{const detail=await api('/api/threads/'+encodeURIComponent(id));if(!same())return;if(detail.goalError||!detail.goal)throw Error('目标暂未读取。');draft.base=detail.goal.objective;draft.text=draft.base;delete draft.uncertain;area.value=draft.text;save();feedback.textContent='已读取当前目标。';}
      catch(error){if(same())feedback.textContent=error.message;}finally{reloading=false;if(same()){reload.disabled=false;submit.disabled=false;area.readOnly=false;}}
    };
    const same=()=>context().id===id&&dialog.open&&dialogVersion===version;
    area.oninput=()=>{draft.text=area.value;save();};
    form.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229){if(e.key==='Enter')e.stopPropagation();}});
    form.onsubmit=async e=>{
      e.preventDefault();if(goalUpdating||reloading||!same())return;
      const now=context(),objective=area.value.trim();
      if(!now.ready||now.busy||now.goalError){feedback.textContent='连接或目标状态尚未确认，草稿已保留。';return;}
      if(!objective){feedback.textContent='请填写目标内容。';area.focus();return;}
      if(!draft.uncertain&&objective===draft.base.trim()&&now.goal?.objective===draft.base){delete selection.goalEdit;save();dialog.close();return;}
      goalUpdating=true;submit.disabled=true;reload.disabled=true;area.readOnly=true;form.setAttribute('aria-busy','true');feedback.textContent='正在保存…';render();
      let saved=false;
      try{
        const route='/api/threads/'+encodeURIComponent(id);
        if(draft.uncertain){
          const detail=await api(route);
          if(detail.goalError||!detail.goal)throw Error('上次保存结果仍未确认，请稍后重试。');
          if(detail.goal.objective===draft.uncertain)saved=true;
          else throw Error('上次保存结果未确认，请关闭编辑框并刷新目标后核对。');
        }else{
          draft.uncertain=objective;save();
          try{await api(route+'/goal',{method:'POST',body:{objective,expectedObjective:draft.base}});saved=true;}
          catch(error){if(error.status>=400&&error.status<500&&error.code!=='OUTCOME_UNKNOWN'){delete draft.uncertain;save();}throw error;}
        }
        if(saved){delete selection.goalEdit;save();if(same())dialog.close();if(context().id===id)await refresh();}
      }catch(error){if(same()){reload.hidden=false;feedback.textContent=(saved?'目标已保存，刷新失败：':'保存未确认：')+error.message;}}
      finally{goalUpdating=false;if(same()){submit.disabled=false;reload.disabled=false;area.readOnly=false;form.setAttribute('aria-busy','false');}render();if(saved&&context().id===id&&dialogVersion===version&&!dialog.open)opener?.focus();}
    };
    area.focus();
  }
  const goalToolbar=installGoalToolbar({input,context:()=>({...context(),busy:context().busy||goalUpdating}),api,refresh,edit:editGoal});
  const suggestions=installSkillSuggestions({input,api,context,select:(entry,range,kind)=>insertReference(entry,kind,range)});
  const planCompletion=installPlanCompletion({host,context,input,notify,send:implementPlan,resetMode:()=>{choice().mode='default';save();}});
  function render(){
    planCompletion.render();goalToolbar.render();
    const c=context();if(selected!==JSON.stringify([c.id,c.cwd])){selected=JSON.stringify([c.id,c.cwd]);suggestions.close();if(dialog.open)dialog.close();}
    if(!c.ready||c.busy)suggestions.close();
    reconcileGoalSelection(choice(),c,save);
    syncReferences();mirror.render();
    mode.title=choice().mode==='plan'?'退出计划模式':'计划：先制定方案';
    mode.setAttribute('aria-pressed',String(choice().mode==='plan'));
    planBadge.hidden=choice().mode!=='plan';
    const currentGoal=Boolean(c.goal);
    goalBadge.hidden=!choice().goalPending||currentGoal;
    goalBadge.textContent='目标 ×';
    goalBadge.title='发送时将输入内容设为目标，点击取消';
    goalBadge.setAttribute('aria-label','取消本次目标设置');
    badges.hidden=planBadge.hidden&&goalBadge.hidden;
    summary.textContent='＋';summary.title='添加图片、技能和工具';summary.dataset.mode=choice().mode;summary.setAttribute('aria-label',choice().mode==='plan'?'更多输入工具，计划模式':'更多输入工具');
    // Attachments can accompany a native turn/steer while the current turn runs.
    for(const control of bar.querySelectorAll('button,select'))control.disabled=!c.ready||c.busy||goalUpdating||(control!==images&&control!==goalBadge&&!(control===goalButton&&c.goal)&&control.dataset.tool!=='skill-picker'&&control.dataset.tool!=='plugin-picker'&&c.active);
    goalButton.disabled=goalButton.disabled||Boolean(c.ephemeral);
    goalButton.textContent=currentGoal?'编辑目标':'目标';goalButton.title=c.ephemeral?'临时聊天不支持目标模式，请在主聊天使用。':currentGoal?'编辑当前目标内容':'用下一条输入设置目标';goalButton.setAttribute('aria-pressed',String(Boolean(choice().goalPending&&!currentGoal)));
    summary.setAttribute('aria-disabled',String(!c.ready||c.busy));if(!c.ready||c.busy)tools.open=false;
    status.textContent=[choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:''].filter(Boolean).join(' · ');status.hidden=!status.textContent;
  }
  // Web access is fixed by owner policy; old stored preferences cannot override it.
  return {render,dismiss:()=>{suggestions.close();tools.open=false;if(dialog.open)dialog.close();},isGoalPending:()=>Boolean(choice().goalPending&&!context().goal),validateSend:(text,active)=>validateGoalDraft(choice(),text,active,context().goal),prepareSend:async(id,text,active)=>{const selection=selections.get(id);const started=selection?await prepareGoalSubmission({selection,id,text,active,goal:context().id===id?context().goal:null,api,save}):false;render();return started;},moveDraft:(from,to)=>{if(selections.has(from)){selections.set(to,selections.get(from));selections.delete(from);save();}},options:()=>{syncReferences();const {mode,skills,plugins,threads}=choice();return {mode,skills:[...skills],plugins:[...plugins],threads:[...threads],access:WEB_ACCESS};},isLoading:()=>loading};
}

// Match the desktop's completed native plan item, never infer plans from prose.
export function completedPlan(turns=[]) {
  const turn=turns.at(-1);
  if(!turn?.id||(turn.status?.type||turn.status)!=='completed')return null;
  const item=[...(turn.items||[])].reverse().find(item=>item.type==='plan');
  if(!item?.text?.trim())return null;
  return {turnId:turn.id,text:item.text.trim()};
}
export function implementationText(plan){return 'PLEASE IMPLEMENT THIS PLAN:\n'+plan.text;}

export function installPlanCompletion({host,context,resetMode,send,notify,input=document.getElementById('message-input')}) {
  const key='rcm.planCompletion.'+host;
  let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
  const records=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};
  const save=()=>{try{sessionStorage.setItem(key,JSON.stringify(records));}catch{notify('计划选项状态未保存，刷新后请核对会话。',true);}};
  const card=document.createElement('section');card.className='plan-completion';card.hidden=true;card.setAttribute('aria-label','执行计划');
  const heading=document.createElement('strong');heading.textContent='执行此计划？';
  const actions=document.createElement('div');actions.className='plan-completion-actions';
  const yes=document.createElement('button');yes.type='button';yes.textContent='是，执行此计划';
  const no=document.createElement('button');no.type='button';no.textContent='暂不执行';
  const review=document.createElement('button');review.type='button';review.textContent='已核对未执行，重新选择';
  const status=document.createElement('p');status.setAttribute('role','status');
  actions.append(yes,no,review);card.append(heading,actions,status);
  input.closest('form').before(card);
  let current=null,pending=null;
  const record=(id,plan)=>records[id]?.turnId===plan.turnId?records[id]:null;
  function render(){
    const c=context(),plan=c.draft||c.desktop?null:completedPlan(c.turns);
    current=plan?{id:c.id,plan}:null;
    // This is only a UI preference; execution always uses native turn/start.
    if(plan&&!record(c.id,plan)){records[c.id]={turnId:plan.turnId,state:'open'};resetMode();save();}
    const r=plan&&record(c.id,plan);
    card.hidden=!r||r.state==='dismissed'||r.state==='sent'||c.active;
    const sending=pending===c.id,uncertain=r?.state==='uncertain'&&!sending;
    card.setAttribute('aria-busy',String(sending));
    yes.disabled=!c.ready||c.busy||sending||uncertain;no.disabled=sending;
    yes.hidden=uncertain;review.hidden=!uncertain;review.disabled=sending||!c.ready||c.busy;
    status.textContent=sending?'正在提交…':uncertain?'执行结果未确认，请先核对会话记录，避免重复执行。':r?.error||(!c.ready?'连接恢复后可执行，草稿已保留。':'');status.hidden=!status.textContent;
  }
  function dismiss(){if(!current||pending===current.id)return;records[current.id].state='dismissed';save();render();input.focus();}
  no.onclick=dismiss;
  card.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();dismiss();}});
  review.onclick=()=>{if(!current||review.disabled)return;records[current.id].state='open';delete records[current.id].error;save();render();yes.focus();};
  yes.onclick=async()=>{
    if(!current||yes.disabled)return;
    const {id,plan}=current,r=record(id,plan);resetMode();pending=id;r.state='uncertain';delete r.error;save();render();
    try{await send(id,plan);r.state='sent';}
    catch(error){const rejected=error.status>=400&&error.status<500&&!['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(error.code);r.state=rejected?'open':'uncertain';r.error=error.message;notify(error.message,true);}
    finally{pending=null;save();render();if(context().id===id&&r.state==='sent')input.focus();}
  };
  return {render};
}
