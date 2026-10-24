import {installGoalToolbar,installGoalEditor} from './goal-toolbar.js';
import {validateGoalDraft,prepareGoalSubmission,reconcileGoalSelection} from './goal-submit.js';
import {installSkillSuggestions} from './skill-suggestions.js';
import {installInlineMentions,mentionRanges} from './inline-mentions.js';
export const WEB_ACCESS='full';

export function installComposer({host,api,context,refresh,notify,implementPlan,input=document.getElementById('message-input'),images=document.getElementById('add-images'),prefix=''}) {
  if(!document.querySelector('link[href="/composer.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);}
  const bar=document.createElement('div');bar.className='composer-tools';
  input.form.querySelector('.composer-bottom').prepend(bar);
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)):[]);let selected,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id);};
  const controls=installComposerControls({bar,images,prefix,actions:{
    mode:()=>{choice().mode=choice().mode==='plan'?'default':'plan';choice().goalPending=false;save();render();controls.closeMenu();controls.focusMenu();},
    cancelPlan:()=>{choice().mode='default';save();render();controls.focusMenu();},
    cancelGoal:()=>{choice().goalPending=false;save();render();controls.focusMenu();},
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
  let goalEditor,catalog;
  const dialogController=installComposerDialog({input,beforeOpen:()=>{goalEditor?.clear();catalog?.clear();},dismissMenu:()=>controls.closeMenu()});
  const dialog=dialogController.dialog;
  function open(title,button){dialogController.open(title,button);return context();}
  catalog=installComposerCatalog({dialog,input,context,open,version:dialogController.version,api,choice,present,insertReference,syncReferences,save,render,loading:value=>{loading=value;}});
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
    save();render();controls.closeMenu();input.focus();
  }
  let goalUpdating=false;
  goalEditor=installGoalEditor({dialog,input,context,api,open,version:dialogController.version,opener:dialogController.opener,choice,save,render,refresh,notify,updating:{get:()=>goalUpdating,set:value=>{goalUpdating=value;}}});
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
    controls.render({plan:choice().mode==='plan',goalPending:Boolean(choice().goalPending),currentGoal,ephemeral:Boolean(c.ephemeral),disabled,menuDisabled:Boolean(!c.ready||c.busy),active:Boolean(c.active),status:[choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:''].filter(Boolean).join(' · ')});
    // Attachments can accompany a native turn/steer while the current turn runs.
    images.disabled=disabled;

  }
  // Web access is fixed by owner policy; old stored preferences cannot override it.
  return {render,dismiss:()=>{suggestions.close();controls.closeMenu();if(dialog.open)dialog.close();},isGoalPending:()=>Boolean(choice().goalPending&&!context().goal),validateSend:(text,active)=>validateGoalDraft(choice(),text,active,context().goal),prepareSend:async(id,text,active)=>{const selection=selections.get(id);const started=selection?await prepareGoalSubmission({selection,id,text,active,goal:context().id===id?context().goal:null,api,save}):false;render();return started;},moveDraft:(from,to)=>{if(selections.has(from)){selections.set(to,selections.get(from));selections.delete(from);save();}},options:()=>{syncReferences();const {mode,skills,plugins,threads}=choice();return {mode,skills:[...skills],plugins:[...plugins],threads:[...threads],access:WEB_ACCESS};},isLoading:()=>loading};
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

let composerDialogInstaller;
export function configureComposerDialog(installer){composerDialogInstaller=installer;}
export function installComposerDialog(options){
  if(!composerDialogInstaller)throw new Error('输入工具弹窗尚未初始化。');
  return composerDialogInstaller(options);
}
