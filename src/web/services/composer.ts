import type {NativeGoal,NativeTurn} from '../../contracts/native';
import type {ApiOptions} from './api';
import type {AttachmentButtonControl} from './attachments';
import type {installReactPlanCompletion} from '../components/PlanCompletion';
import type {installReactComposerCatalog} from '../components/ComposerCatalog';
import type {installReactComposerControls} from '../components/ComposerControls';
import type {installReactComposerDialog} from '../components/ComposerDialog';
type Kind='skills'|'plugins'|'threads';
interface Reference {kind:Kind;key:string;token:string}
interface Selection {mode:'default'|'plan';skills:string[];plugins:string[];threads?:string[];references?:Reference[];goalPending?:boolean;goalUncertain?:string;goalEdit?:{base:string;text:string;uncertain?:string};[field:string]:unknown}
export interface ComposerContext {id:string|null;cwd?:string;ready:boolean;busy:boolean;active:boolean;draft?:boolean;desktop?:boolean;ephemeral?:boolean;threadReferencesSupported?:boolean;turns:NativeTurn[];goal?:NativeGoal|null;goalError?:unknown}
interface Options {host:string;api:<T=unknown>(path:string,options?:ApiOptions)=>Promise<T>;context:()=>ComposerContext;refresh:()=>Promise<unknown>;notify:(message:string,error?:boolean)=>unknown;implementPlan:(id:string,plan:{turnId:string;text:string})=>Promise<unknown>;input?:HTMLTextAreaElement;images:AttachmentButtonControl;prefix?:string}
type Entry=Parameters<Parameters<typeof installReactComposerCatalog>[0]['insertReference']>[0];
import {installGoalToolbar,installGoalEditor} from '../../../public/goal-toolbar.js';
import {validateGoalDraft,prepareGoalSubmission,reconcileGoalSelection} from '../../../public/goal-submit.js';
import {installSkillSuggestions} from '../../../public/skill-suggestions.js';
import {installInlineMentions,mentionRanges} from '../../../public/inline-mentions.js';
export const WEB_ACCESS='full';

export function installComposer({host,api,context,refresh,notify,implementPlan,input=document.getElementById('message-input') as HTMLTextAreaElement,images,prefix=''}:Options) {
  if(!document.querySelector('link[href="/composer.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/composer.css';document.head.append(link);}
  const bar=document.createElement('div');bar.className='composer-tools';
  input.form!.querySelector('.composer-bottom')!.prepend(bar);
  const selectionKey='rcm.composer.'+host;let savedSelections;try{savedSelections=JSON.parse(sessionStorage.getItem(selectionKey)||'[]');}catch{}
  const selections=new Map<string|null,Selection>(Array.isArray(savedSelections)?savedSelections.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&['default','plan'].includes(v[1]?.mode)&&Array.isArray(v[1]?.skills)&&Array.isArray(v[1]?.plugins)) as [string,Selection][]:[]);let selected:string|undefined,loading=false;
  const save=()=>{try{sessionStorage.setItem(selectionKey,JSON.stringify([...selections]));}catch{notify('输入工具选择暂未保存，刷新后请重新核对。',true);}};
  const choice=()=>{const id=context().id;if(!selections.has(id))selections.set(id,{mode:'default',skills:[],plugins:[]});return selections.get(id)!;};
  const controls=installComposerControls({bar,images,prefix,actions:{
    mode:()=>{choice().mode=choice().mode==='plan'?'default':'plan';choice().goalPending=false;save();render();controls.closeMenu();controls.focusMenu();},
    cancelPlan:()=>{choice().mode='default';save();render();controls.focusMenu();},
    cancelGoal:()=>{choice().goalPending=false;save();render();controls.focusMenu();},
    goal:()=>selectGoal(),pick:(kind,button)=>void picker(kind,button)
  }});
  const references=():Reference[]=>Array.isArray(choice().references)?choice().references!.filter(r=>r&&['skills','plugins','threads'].includes(r.kind)&&typeof r.key==='string'&&typeof r.token==='string'&&r.token.length>1):[];
  const present=()=>mentionRanges(input.value,references());
  const syncReferences=()=>{const active=present();for(const kind of ['skills','plugins','threads'] as const)choice()[kind]=[...new Set(active.filter(r=>r.kind===kind).map(r=>r.key))];};
  function insertReference(entry:Entry,kind:Kind='skills',range?:{start:number;end:number}){
    const key=(kind==='skills'?entry.path:entry.id)!;
    const token=(kind==='skills'?'$':'@')+(entry.name||key).replace(/\s+/gu,'-')+(kind==='threads'?'·'+key.slice(-8):'');
    const collision=present().find(r=>r.token===token&&r.key!==key);if(collision){notify('同名能力已在草稿中，请先删除原引用再选择。',true);return false;}
    choice().references=[...references().filter(r=>r.token!==token&&!(r.kind===kind&&r.key===key)),{kind,key,token}];
    const start=range?.start??input.selectionStart,end=range?.end??input.selectionEnd;
    input.setRangeText((start>0&&!/\s/u.test(input.value[start-1])?' ':'')+token+' ',start,end,'end');
    syncReferences();save();input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));render();return true;
  }
  const mirror=installInlineMentions(input,references);
  input.addEventListener('input',()=>{syncReferences();save();mirror.render();});
  let goalEditor:ReturnType<typeof installGoalEditor>|undefined,catalog:ReturnType<typeof installComposerCatalog>|undefined;
  const dialogController=installComposerDialog({input,beforeOpen:()=>{goalEditor?.clear();catalog?.clear();},dismissMenu:()=>controls.closeMenu()});
  const dialog=dialogController.dialog;
  function open(title:string,button:HTMLElement){dialogController.open(title,button);return context();}
  catalog=installComposerCatalog({dialog,input,context,open,version:dialogController.version,api,choice,present,insertReference,syncReferences,save,render,loading:value=>{loading=value;}});
  const picker=(kind:'skills'|'plugins',button:HTMLElement)=>catalog!.picker(kind,button);
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
  const editGoal=(button:HTMLElement)=>goalEditor!.edit(button);
  const goalToolbar=installGoalToolbar({input,context:()=>({...context(),busy:context().busy||goalUpdating}),api,refresh,edit:editGoal});
  const suggestions=installSkillSuggestions({input,api,context,select:(entry:Entry,range:{start:number;end:number},kind:Kind)=>insertReference(entry,kind,range)});
  const planCompletion=installPlanCompletion({host,context,input,notify,send:implementPlan,resetMode:()=>{choice().mode='default';save();}});
  function render(){
    planCompletion.render();goalToolbar.render();
    const c=context();if(selected!==JSON.stringify([c.id,c.cwd])){selected=JSON.stringify([c.id,c.cwd]);suggestions.close();if(dialog.open)dialog.close();}
    if(!c.ready||c.busy)suggestions.close();
    reconcileGoalSelection(choice(),c,save);
    syncReferences();mirror.render();
    const currentGoal=Boolean(c.goal),disabled=!c.ready||c.busy||goalUpdating;
    controls.render({desktop:Boolean(c.desktop),plan:!c.desktop&&choice().mode==='plan',goalPending:Boolean(choice().goalPending),currentGoal,ephemeral:Boolean(c.ephemeral),disabled,menuDisabled:Boolean(!c.ready||c.busy),active:Boolean(c.active),status:[choice().skills.length?'技能 '+choice().skills.length:'',choice().plugins.length?'插件 '+choice().plugins.length:''].filter(Boolean).join(' · ')});
    // Attachments can accompany a native turn/steer while the current turn runs.
    images.setDisabled(disabled);

  }
  // Web access is fixed by owner policy; old stored preferences cannot override it.
  return {render,dismiss:()=>{suggestions.close();controls.closeMenu();if(dialog.open)dialog.close();},isGoalPending:()=>Boolean(choice().goalPending&&!context().goal),validateSend:(text:string,active:boolean)=>validateGoalDraft(choice(),text,active,context().goal),prepareSend:async(id:string,text:string,active:boolean)=>{const selection=selections.get(id);const started=selection?await prepareGoalSubmission({selection,id,text,active,goal:context().id===id?context().goal:null,api,save}):false;render();return started;},moveDraft:(from:string,to:string)=>{if(selections.has(from)){selections.set(to,selections.get(from)!);selections.delete(from);save();}},options:()=>{syncReferences();const {mode,skills,plugins,threads}=choice();return {mode,skills:[...skills],plugins:[...plugins],threads:[...threads!],access:WEB_ACCESS};},isLoading:()=>loading};
}

// Match the desktop's completed native plan item, never infer plans from prose.
export function completedPlan(turns:NativeTurn[]=[]) {
  const turn=turns.at(-1);
  if(!turn?.id||((turn.status as {type?:string}|undefined)?.type||turn.status)!=='completed')return null;
  const item=[...(turn.items||[])].reverse().find(item=>item.type==='plan');
  if(!item?.text?.trim())return null;
  return {turnId:turn.id,text:item.text.trim()};
}
export function implementationText(plan:{text:string}){return 'PLEASE IMPLEMENT THIS PLAN:\n'+plan.text;}

let planCompletionInstaller:typeof installReactPlanCompletion|undefined;
export function configurePlanCompletion(installer:typeof installReactPlanCompletion){planCompletionInstaller=installer;}
export function installPlanCompletion(options:Parameters<typeof installReactPlanCompletion>[0]){
  if(!planCompletionInstaller)throw new Error('计划执行卡片尚未初始化。');
  return planCompletionInstaller(options);
}

let catalogInstaller:typeof installReactComposerCatalog|undefined;
export function configureComposerCatalog(installer:typeof installReactComposerCatalog){catalogInstaller=installer;}
export function installComposerCatalog(options:Parameters<typeof installReactComposerCatalog>[0]){
  if(!catalogInstaller)throw new Error('输入目录尚未初始化。');
  return catalogInstaller(options);
}

let composerControlsInstaller:typeof installReactComposerControls|undefined;
export function configureComposerControls(installer:typeof installReactComposerControls){composerControlsInstaller=installer;}
export function installComposerControls(options:Parameters<typeof installReactComposerControls>[0]){
  if(!composerControlsInstaller)throw new Error('输入模式控件尚未初始化。');
  return composerControlsInstaller(options);
}

let composerDialogInstaller:typeof installReactComposerDialog|undefined;
export function configureComposerDialog(installer:typeof installReactComposerDialog){composerDialogInstaller=installer;}
export function installComposerDialog(options:Parameters<typeof installReactComposerDialog>[0]){
  if(!composerDialogInstaller)throw new Error('输入工具弹窗尚未初始化。');
  return composerDialogInstaller(options);
}
