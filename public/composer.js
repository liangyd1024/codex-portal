import {validateGoalDraft,prepareGoalSubmission} from './goal-submit.js';
import {installSkillSuggestions} from './skill-suggestions.js';
import {installInlineMentions,mentionRanges} from './inline-mentions.js';
export const WEB_ACCESS='full';

export function installComposer({host,api,context,refresh,notify,implementPlan}) {
  const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);
  const bar=document.createElement('div');bar.className='composer-tools';
  bar.innerHTML='<button type="button" id="execution-mode" aria-pressed="false">计划</button><button type="button" id="goal-settings">目标</button><button type="button" id="skill-picker">技能</button><button type="button" id="plugin-picker">插件</button><span id="composer-tools-status" role="status"></span>';
  const tools=document.createElement('details');tools.className='composer-options';
  const summary=document.createElement('summary');summary.textContent='＋';summary.setAttribute('aria-label','更多输入工具');const panel=document.createElement('div');panel.className='composer-options-panel';
  for(const button of bar.querySelectorAll('button'))panel.append(button);tools.append(summary,panel);bar.querySelector('[role=status]').before(tools);
  const badges=document.createElement('div');badges.className='composer-mode-badges';
  const planBadge=document.createElement('button');planBadge.type='button';planBadge.className='composer-mode-badge';planBadge.textContent='计划 ×';planBadge.setAttribute('aria-label','退出计划模式');
  const goalBadge=document.createElement('button');goalBadge.type='button';goalBadge.className='composer-mode-badge';
  badges.append(planBadge,goalBadge);tools.after(badges);
  const position=()=>{if(!tools.open)return;const v=window.visualViewport,top=v?.offsetTop||0,left=v?.offsetLeft||0,height=v?.height||innerHeight,width=v?.width||innerWidth;panel.style.maxHeight=Math.max(44,height-24)+'px';panel.style.maxWidth=Math.max(0,width-16)+'px';panel.style.right='auto';panel.style.left=Math.max(left+8,Math.min(summary.getBoundingClientRect().left,left+width-panel.offsetWidth-8))+'px';panel.style.top=Math.max(top+8,summary.getBoundingClientRect().top-panel.offsetHeight-8)+'px';};
  tools.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(tools.open));position();});window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  tools.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tools.open=false;summary.focus();}});
  document.addEventListener('pointerdown',e=>{if(!tools.contains(e.target))tools.open=false;});
  document.querySelector('.composer-bottom').prepend(bar);
  const images=document.getElementById('add-images');images.classList.remove('icon-button');images.textContent='添加图片';panel.prepend(images);images.addEventListener('click',()=>{tools.open=false;});
  panel.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.tagName==='SELECT')return;const items=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),select:not(:disabled)')];const i=items.indexOf(document.activeElement);e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();});
  summary.addEventListener('click',e=>{if(summary.getAttribute('aria-disabled')==='true')e.preventDefault();});
  summary.addEventListener('keydown',e=>{if(summary.getAttribute('aria-disabled')==='true'){e.preventDefault();return;}if(e.key==='ArrowDown'){e.preventDefault();tools.open=true;panel.querySelector('button:not(:disabled)')?.focus();}});
  const mode=bar.querySelector('#execution-mode'),status=bar.querySelector('#composer-tools-status');
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)):[]);let selected,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id);};
  mode.onclick=()=>{choice().mode=choice().mode==='plan'?'default':'plan';choice().goalPending=false;save();render();tools.open=false;summary.focus();};
  planBadge.onclick=()=>{choice().mode='default';save();render();summary.focus();};
  goalBadge.onclick=()=>{if(choice().goalPending){choice().goalPending=false;save();render();summary.focus();}else{tools.open=true;position();bar.querySelector('#goal-settings').focus();}};
  const input=document.getElementById('message-input');
  const references=()=>Array.isArray(choice().references)?choice().references.filter(r=>r&&['skills','plugins'].includes(r.kind)&&typeof r.key==='string'&&typeof r.token==='string'&&r.token.length>1):[];
  const present=()=>mentionRanges(input.value,references());
  const syncReferences=()=>{const active=present();for(const kind of ['skills','plugins'])choice()[kind]=[...new Set(active.filter(r=>r.kind===kind).map(r=>r.key))];};
  function insertReference(entry,kind='skills',range){
    const key=kind==='skills'?entry.path:entry.id;
    const token=(kind==='skills'?'$':'@')+(entry.name||key).replace(/\s+/gu,'-');
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
  bar.querySelector('#skill-picker').onclick=e=>void picker('skills',e.currentTarget);
  bar.querySelector('#plugin-picker').onclick=e=>void picker('plugins',e.currentTarget);
  const goalButton=bar.querySelector('#goal-settings');
  goalButton.onclick=()=>{
    const next=!choice().goalPending;
    choice().goalPending=next;
    if(next){choice().mode='default';delete choice().goalUncertain;}
    save();render();tools.open=false;input.focus();
  };
  let goalUpdating=false;
  const goalActions=[];
  for(const [value,name] of [['paused','暂停目标'],['active','继续目标'],['complete','完成目标']]){
    const button=text('button',name);button.type='button';panel.append(button);goalActions.push({button,value});
    button.onclick=async()=>{
      if(goalUpdating)return;
      const id=context().id;goalUpdating=true;tools.open=false;render();
      try{await api('/api/threads/'+encodeURIComponent(id)+'/goal',{method:'POST',body:{status:value}});if(context().id===id)await refresh();}
      catch(error){notify('目标状态未确认：'+error.message,true);}
      finally{goalUpdating=false;render();}
    };
  }
  const suggestions=installSkillSuggestions({input,api,context,select:(entry,range)=>insertReference(entry,'skills',range)});
  const planCompletion=installPlanCompletion({host,context,notify,send:implementPlan,resetMode:()=>{choice().mode='default';save();}});
  function render(){
    planCompletion.render();
    const c=context();if(selected!==JSON.stringify([c.id,c.cwd])){selected=JSON.stringify([c.id,c.cwd]);suggestions.close();if(dialog.open)dialog.close();}
    if(!c.ready||c.busy||c.active)suggestions.close();
    syncReferences();mirror.render();
    mode.title=choice().mode==='plan'?'退出计划模式':'计划：先制定方案';
    mode.setAttribute('aria-pressed',String(choice().mode==='plan'));
    planBadge.hidden=choice().mode!=='plan';
    goalBadge.hidden=!choice().goalPending&&!c.goal&&!c.goalError;
    goalBadge.textContent=choice().goalPending?'目标 ×':c.goalError?'目标待确认':({active:'目标',paused:'目标已暂停',complete:'目标已完成'}[c.goal?.status]||'目标待确认');
    goalBadge.title=choice().goalPending?'发送时将输入内容设为目标，点击取消':c.goalError?'目标状态暂未读取，点击重新检查':c.goal?.objective||'查看目标';
    goalBadge.setAttribute('aria-label',choice().goalPending?'取消本次目标设置':goalBadge.textContent+'，目标操作');
    badges.hidden=planBadge.hidden&&goalBadge.hidden;
    summary.textContent='＋';summary.title='添加图片、技能和工具';summary.dataset.mode=choice().mode;summary.setAttribute('aria-label',choice().mode==='plan'?'更多输入工具，计划模式':'更多输入工具');
    // Attachments can accompany a native turn/steer while the current turn runs.
    for(const control of bar.querySelectorAll('button,select'))control.disabled=!c.ready||c.busy||goalUpdating||(control!==images&&c.active);
    goalButton.title='用下一条输入设置目标';goalButton.setAttribute('aria-pressed',String(Boolean(choice().goalPending)));
    for(const {button,value} of goalActions)button.hidden=c.draft||!c.goal||Boolean(c.goalError)||(value==='paused'?c.goal.status!=='active':value==='active'?c.goal.status!=='paused':c.goal.status==='complete');
    summary.setAttribute('aria-disabled',String(!c.ready||c.busy));if(!c.ready||c.busy)tools.open=false;
    status.textContent=[choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:''].filter(Boolean).join(' · ');status.hidden=!status.textContent;
  }
  // Web access is fixed by owner policy; old stored preferences cannot override it.
  return {render,validateSend:(text,active)=>validateGoalDraft(choice(),text,active),prepareSend:async(id,text,active)=>{const selection=selections.get(id);const started=selection?await prepareGoalSubmission({selection,id,text,active,api,save}):false;render();return started;},moveDraft:(from,to)=>{if(selections.has(from)){selections.set(to,selections.get(from));selections.delete(from);save();}},options:()=>{syncReferences();const {mode,skills,plugins}=choice();return {mode,skills:[...skills],plugins:[...plugins],access:WEB_ACCESS};},isLoading:()=>loading};
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

export function installPlanCompletion({host,context,resetMode,send,notify}) {
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
  document.getElementById('message-input').closest('form').before(card);
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
  function dismiss(){if(!current||pending===current.id)return;records[current.id].state='dismissed';save();render();document.getElementById('message-input').focus();}
  no.onclick=dismiss;
  card.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();dismiss();}});
  review.onclick=()=>{if(!current||review.disabled)return;records[current.id].state='open';delete records[current.id].error;save();render();yes.focus();};
  yes.onclick=async()=>{
    if(!current||yes.disabled)return;
    const {id,plan}=current,r=record(id,plan);resetMode();pending=id;r.state='uncertain';delete r.error;save();render();
    try{await send(id,plan);r.state='sent';}
    catch(error){const rejected=error.status>=400&&error.status<500&&!['OUTCOME_UNKNOWN','RPC_TIMEOUT'].includes(error.code);r.state=rejected?'open':'uncertain';r.error=error.message;notify(error.message,true);}
    finally{pending=null;save();render();if(context().id===id&&r.state==='sent')document.getElementById('message-input').focus();}
  };
  return {render};
}
