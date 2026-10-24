import {installGoalToolbar,installGoalEditor} from './goal-toolbar.js';
import {validateGoalDraft,prepareGoalSubmission,reconcileGoalSelection} from './goal-submit.js';
import {installSkillSuggestions} from './skill-suggestions.js';
import {installInlineMentions,mentionRanges} from './inline-mentions.js';
export const WEB_ACCESS='full';

export function installComposer({host,api,context,refresh,notify,implementPlan,input=document.getElementById('message-input'),images=document.getElementById('add-images'),prefix=''}) {
  if(!document.querySelector('link[href="/composer.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);}
  const bar=document.createElement('div');bar.className='composer-tools';
  const tools=document.createElement('details');tools.className='composer-options';
  const summary=document.createElement('summary');summary.textContent='＋';summary.setAttribute('aria-label','更多输入工具');const panel=document.createElement('div');panel.className='composer-options-panel';
  tools.append(summary,panel);
  const badges=document.createElement('div');badges.className='composer-mode-badges';bar.append(tools,badges);
  const position=()=>{if(!tools.open)return;const v=window.visualViewport,top=v?.offsetTop||0,left=v?.offsetLeft||0,height=v?.height||innerHeight,width=v?.width||innerWidth;panel.style.maxHeight=Math.max(44,height-24)+'px';panel.style.maxWidth=Math.max(0,width-16)+'px';panel.style.right='auto';panel.style.left=Math.max(left+8,Math.min(summary.getBoundingClientRect().left,left+width-panel.offsetWidth-8))+'px';panel.style.top=Math.max(top+8,Math.min(summary.getBoundingClientRect().top-panel.offsetHeight-8,top+height-panel.offsetHeight-8))+'px';};
  tools.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(tools.open));position();});window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  tools.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tools.open=false;summary.focus();}});
  document.addEventListener('pointerdown',e=>{if(!tools.contains(e.target))tools.open=false;});
  input.form.querySelector('.composer-bottom').prepend(bar);
  images.classList.remove('icon-button');images.textContent='添加图片';panel.prepend(images);images.addEventListener('click',()=>{tools.open=false;});
  panel.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.tagName==='SELECT')return;const items=[...panel.querySelectorAll('button:not(:disabled):not([hidden]),select:not(:disabled)')];const i=items.indexOf(document.activeElement);e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();});
  summary.addEventListener('click',e=>{e.preventDefault();if(summary.getAttribute('aria-disabled')==='true')return;tools.open=!tools.open;summary.setAttribute('aria-expanded',String(tools.open));position();});
  summary.addEventListener('keydown',e=>{if(summary.getAttribute('aria-disabled')==='true'){e.preventDefault();return;}if(e.key==='ArrowDown'){e.preventDefault();tools.open=true;summary.setAttribute('aria-expanded','true');position();panel.querySelector('button:not(:disabled)')?.focus();}});
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)):[]);let selected,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id);};
  const controls=installComposerControls({bar,panel,badges,prefix,actions:{
    mode:()=>{choice().mode=choice().mode==='plan'?'default':'plan';choice().goalPending=false;save();render();tools.open=false;summary.focus();},
    cancelPlan:()=>{choice().mode='default';save();render();summary.focus();},
    cancelGoal:()=>{choice().goalPending=false;save();render();summary.focus();},
    goal:()=>selectGoal(),pick:(kind,button)=>void picker(kind,button)
  }});
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
  let opener,dialogVersion=0,goalEditor,catalog;
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  dialog.addEventListener('close',()=>{if(!dialog.open&&document.activeElement!==input)opener?.focus();});
  function open(title,button){
    dialogVersion++;goalEditor?.clear();catalog?.clear();opener=button.closest('details')?.querySelector('summary')||button;tools.open=false;dialog.replaceChildren();
    const heading=document.createElement('h2');heading.textContent=title;
    const close=document.createElement('button');close.type='button';close.textContent='关闭';close.className='composer-dialog-close';close.onclick=()=>dialog.close();
    dialog.append(heading,close);dialog.showModal();return context();
  }
  catalog=installComposerCatalog({dialog,input,context,open,version:()=>dialogVersion,api,choice,present,insertReference,syncReferences,save,render,loading:value=>{loading=value;}});
  const picker=(kind,button)=>catalog.picker(kind,button);
  const goalButton=controls.goalButton;
  function selectGoal(){
    const c=context();
    if(c.ephemeral){notify('临时聊天不支持目标模式，请在主聊天设置目标。',true);return;}
    if(c.goalError){notify('目标暂未读取，请刷新后重试。',true);return;}
    if(c.goal){editGoal(goalButton);return;}
    const next=!choice().goalPending;
    choice().goalPending=next;
    if(next){choice().mode='default';delete choice().goalUncertain;}
    save();render();tools.open=false;input.focus();
  }
  let goalUpdating=false;
  goalEditor=installGoalEditor({dialog,input,context,api,open,version:()=>dialogVersion,opener:()=>opener,choice,save,render,refresh,notify,updating:{get:()=>goalUpdating,set:value=>{goalUpdating=value;}}});
  const editGoal=button=>goalEditor.edit(button);
  const goalToolbar=installGoalToolbar({input,context:()=>({...context(),busy:context().busy||goalUpdating}),api,refresh,edit:editGoal});
  const suggestions=installSkillSuggestions({input,api,context,select:(entry,range,kind)=>insertReference(entry,kind,range)});
  const planCompletion=installPlanCompletion({host,context,input,notify,send:implementPlan,resetMode:()=>{choice().mode='default';save();}});
  function render(){
    planCompletion.render();goalToolbar.render();
    const c=context();if(selected!==JSON.stringify([c.id,c.cwd])){selected=JSON.stringify([c.id,c.cwd]);suggestions.close();if(dialog.open)dialog.close();}
    if(!c.ready||c.busy)suggestions.close();
    reconcileGoalSelection(choice(),c,save);
    syncReferences();mirror.render();
    const currentGoal=Boolean(c.goal),disabled=!c.ready||c.busy||goalUpdating;
    controls.render({plan:choice().mode==='plan',goalPending:Boolean(choice().goalPending),currentGoal,ephemeral:Boolean(c.ephemeral),disabled,active:Boolean(c.active),status:[choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:''].filter(Boolean).join(' · ')});
    summary.textContent='＋';summary.title='添加图片、技能和工具';summary.dataset.mode=choice().mode;summary.setAttribute('aria-label',choice().mode==='plan'?'更多输入工具，计划模式':'更多输入工具');
    // Attachments can accompany a native turn/steer while the current turn runs.
    images.disabled=disabled;
    summary.setAttribute('aria-disabled',String(!c.ready||c.busy));if(!c.ready||c.busy)tools.open=false;

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

let planCompletionInstaller;
export function configurePlanCompletion(installer){planCompletionInstaller=installer;}
export function installPlanCompletion(options){
  if(!planCompletionInstaller)throw new Error('计划执行卡片尚未初始化。');
  return planCompletionInstaller(options);
}

let catalogInstaller;
export function configureComposerCatalog(installer){catalogInstaller=installer;}
export function installComposerCatalog(options){
  if(!catalogInstaller)throw new Error('输入目录尚未初始化。');
  return catalogInstaller(options);
}

let composerControlsInstaller;
export function configureComposerControls(installer){composerControlsInstaller=installer;}
export function installComposerControls(options){
  if(!composerControlsInstaller)throw new Error('输入模式控件尚未初始化。');
  return composerControlsInstaller(options);
}
