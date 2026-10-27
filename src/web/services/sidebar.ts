import {RunningFilter,type RunningView} from './running-filter.ts';
import type {NativeThread,NativeProject} from '../../contracts/native';
import type {ApiOptions} from './api';
import type {Group,Item,MenuEntry} from './sidebar-tree';
import type {installReactSidebarTree} from '../components/SidebarTree';
import type {installReactSidebarMenu} from '../components/SidebarMenu';
import type {installReactSidebarDialog} from '../components/SidebarDialog';
import type {installReactSidebarUndo} from '../components/SidebarUndo';
import type {installReactSidebarToolbar} from '../components/SidebarToolbar';
export interface SidebarThread extends NativeThread {recencyAt?:number;updatedAt?:number;sectionId?:string|null;sectionPosition?:number;isPinned?:boolean;isUnread?:boolean;readRevision?:unknown;revision?:unknown}
export interface SidebarProject extends NativeProject {name:string;threadIds:string[];legacyId?:string;recencyAt?:number;updatedAt?:number;aliasIds?:string[]}
export interface SidebarSection {id:string;name:string;desktopId?:string;projectIds:string[];threadIds:string[];itemOrder?:string[];revision?:unknown;[field:string]:unknown}
export interface SidebarSnapshot {selectedThread?:SidebarThread;historySource?:string;accountScope:string;data:SidebarThread[];projects:SidebarProject[];sections:SidebarSection[];pinnedProjectIds:string[];pinnedThreadIds:string[];rootProjectIds:string[];rootThreadIds:string[];pinnedOrder?:string[];chatOrder?:string[];sectionOrder?:string[];hostName?:string;archived?:boolean;nextCursor?:string|null;preferences:{chats?:string;pinned?:string;grouping?:string};capabilities:Record<string,{supported:boolean;reason?:string}>;[field:string]:unknown}
interface View {search?:string;loading?:boolean;failed?:boolean}
interface Options {node:HTMLElement;host:string;connected:()=>boolean;onArchiveView:(archived:boolean)=>void;api:<T=SidebarSnapshot>(path:string,options?:ApiOptions)=>Promise<T>;toast:(message:string,error?:boolean)=>unknown;selectedId:()=>string|null;newThread:(root?:string)=>unknown;needsAnswer?:(id:string)=>boolean;activitySource?:(thread:SidebarThread)=>string|null;relativeTime:(time:number|undefined)=>string;threadName:(thread:SidebarThread)=>string;select:(thread:SidebarThread)=>unknown;changed:(action:string,target:SidebarThread|SidebarSection|null)=>Promise<unknown>;refresh:()=>Promise<unknown>;retry?:()=>Promise<unknown>;icon?:unknown}
type Target=SidebarThread|SidebarSection|null;
import {activitySource} from '../../../public/activity.js';
function orderItems<T extends Item>(items:T[],keys:string[]=[],orderedThreadIds:string[]|null=null):T[]{
  const rank=new Map(keys.map((key,i)=>[key,i]));
  const result=[...items].sort((a,b)=>(rank.get(a.kind+':'+a.value.id)??Infinity)-(rank.get(b.kind+':'+b.value.id)??Infinity));
  if(orderedThreadIds){const byId=new Map(result.filter(i=>i.kind==='thread').map(i=>[i.value.id,i]));const ordered=orderedThreadIds.flatMap(id=>byId.has(id)?[byId.get(id)]:[]);let index=0;return result.map(i=>i.kind==='thread'?ordered[index++]||i:i);}
  return result;
}
// Collapse only the presentation. Native project IDs and thread membership stay intact.
const rootKey=(roots:unknown)=>Array.isArray(roots)&&roots.length&&roots.every(r=>typeof r==='string'&&r.startsWith('/'))?JSON.stringify([...new Set(roots.map(r=>r.replace(/\/+$/,'')||'/'))].sort()):null;
export function projectFolderOptions(projects:{roots?:string[];name?:string}[]){
  const seen=new Set();
  return projects.flatMap(p=>(p.roots||[]).filter(root=>typeof root==='string'&&root.startsWith('/')).flatMap(root=>{
    const key=root.replace(/\/+$/,'')||'/';
    if(seen.has(key))return [];seen.add(key);return [{root,name:p.name||key.split('/').pop()||'/'}];
  }));
}
function projectPresentation(snapshot:SidebarSnapshot):SidebarSnapshot{
  const preferred=[...snapshot.pinnedProjectIds,...snapshot.sections.flatMap(s=>s.projectIds),...snapshot.projects.filter(p=>p.legacyId&&p.legacyId!==p.id).map(p=>p.id),...snapshot.rootProjectIds];
  const rank=new Map<string,number>();preferred.forEach((id,i)=>{if(!rank.has(id))rank.set(id,i);});
  const groups=new Map<string,SidebarProject[]>(),aliases=new Map<string,string>();
  for(const p of snapshot.projects){const key=rootKey(p.roots)||'id:'+p.id;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(p);}
  const projects:SidebarProject[]=[];
  for(const group of groups.values()){
    const ordered=[...group].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
    const selected=ordered[0];group.forEach(p=>aliases.set(p.id,selected.id));
    let threadIds=[...new Set(ordered.flatMap(p=>p.threadIds))];
    if(group.length>1&&snapshot.preferences?.chats!=='manual'){
      const threads=new Map(snapshot.data.map(t=>[t.id,t]));
      threadIds.sort((a,b)=>(threads.get(b)?.recencyAt||threads.get(b)?.updatedAt||0)-(threads.get(a)?.recencyAt||threads.get(a)?.updatedAt||0)||a.localeCompare(b));
    }
    projects.push({...selected,aliasIds:group.map(p=>p.id),threadIds,recencyAt:Math.max(...group.map(p=>p.recencyAt||0))});
  }
  const ids=(values:string[])=>[...new Set(values.map(id=>aliases.get(id)||id))];
  const keys=(values:string[]|undefined)=>(values||[]).map(key=>key.startsWith('project:')?'project:'+(aliases.get(key.slice(8))||key.slice(8)):key);
  return {...snapshot,projects,pinnedProjectIds:ids(snapshot.pinnedProjectIds),rootProjectIds:ids(snapshot.rootProjectIds),pinnedOrder:keys(snapshot.pinnedOrder),sections:snapshot.sections.map(s=>({...s,projectIds:ids(s.projectIds),itemOrder:keys(s.itemOrder)}))};
}
export function sidebarGroups(snapshot:SidebarSnapshot):Group[]{
  snapshot=projectPresentation(snapshot);
  const threads=new Map(snapshot.data.map(t=>[t.id,t])),projects=new Map(snapshot.projects.map(p=>[p.id,p]));
  const seenThreads=new Set(),seenProjects=new Set();
  const thread=(ids:string[]):Extract<Item,{kind:"thread"}>[]=>ids.filter(id=>threads.has(id)&&!seenThreads.has(id)&&seenThreads.add(id)).map(id=>({kind:'thread',value:threads.get(id)!}));
  const project=(ids:string[]):Extract<Item,{kind:"project"}>[]=>ids.filter(id=>projects.has(id)&&!seenProjects.has(id)&&seenProjects.add(id)).map(id=>({kind:'project',value:projects.get(id)!,children:thread(projects.get(id)!.threadIds)}));
  if(snapshot.archived)return [{id:'archive',name:'已归档',items:thread(snapshot.data.map(t=>t.id))}];
  const pinnedThreads=thread(snapshot.pinnedThreadIds);
  let pinned=[...project(snapshot.pinnedProjectIds),...pinnedThreads];
  if(snapshot.preferences?.pinned==='updated_at')pinned.sort((a,b)=>(b.value.recencyAt||b.value.updatedAt||0)-(a.value.recencyAt||a.value.updatedAt||0)||a.value.id.localeCompare(b.value.id));
  else pinned=orderItems(pinned,snapshot.pinnedOrder,snapshot.pinnedThreadIds);
  const groups:Group[]=[{id:'pinned',name:'置顶',items:pinned}];
  for(const s of snapshot.sections){const chats=thread(s.threadIds);groups.push({id:s.id,name:s.name,section:s,items:orderItems([...project(s.projectIds),...chats],s.itemOrder,s.threadIds)});}
  const mode=snapshot.preferences?.grouping||'project';
  if(mode==='project')groups.push({id:'threads',name:'项目',items:project(snapshot.rootProjectIds)});
  // List/connection grouping flattens only unplaced projects; custom and pinned projects retain their children.
  let remaining=thread(mode==='project'?snapshot.rootThreadIds:snapshot.data.map(t=>t.id));
  remaining.push(...thread(snapshot.data.map(t=>t.id)));
  if(snapshot.preferences?.chats==='manual')remaining=orderItems(remaining,snapshot.chatOrder);
  else remaining.sort((a,b)=>(b.value.recencyAt||b.value.updatedAt||0)-(a.value.recencyAt||a.value.updatedAt||0)||a.value.id.localeCompare(b.value.id));
  groups.push({id:mode==='connection'?'threads':'chats',name:mode==='connection'?(snapshot.hostName||'当前机器'):'会话',items:remaining});
  const rank=new Map((snapshot.sectionOrder||[]).map((id,i)=>[id,i]));
  groups.sort((a,b)=>(rank.get(a.section?'custom:'+a.section.desktopId:a.id)??999)-(rank.get(b.section?'custom:'+b.section.desktopId:b.id)??999));
  return groups.filter(g=>g.items.length||g.section);
}
export class Sidebar {
 running=false;runningFilter=new RunningFilter();runningView:RunningView|null=null;private savedScroll=0;
 declare o:Options;declare node:HTMLElement;declare snapshot:SidebarSnapshot|null;declare pending:boolean;declare menu:HTMLElement|null;declare dialog:HTMLDialogElement|null;declare scope:string|null;declare expanded:Set<string>;declare searchOverrides:Map<string,boolean>;declare searchExpanded:boolean;
 declare treeView:ReturnType<typeof installReactSidebarTree>;declare dialogView:ReturnType<typeof installReactSidebarDialog>;declare menuView:ReturnType<typeof installReactSidebarMenu>;declare toolbarView:ReturnType<typeof installReactSidebarToolbar>;declare undoView:ReturnType<typeof installReactSidebarUndo>;
 declare toolbar:HTMLDivElement;declare progress:ReturnType<typeof installReactSidebarToolbar>['progress'];declare menuAnchor:HTMLElement|undefined;declare view:View|undefined;declare drag:SidebarThread|null|undefined;declare archiving:Map<string,SidebarThread>|undefined;declare operations:Map<string,string>|undefined;declare renderShape:string|undefined;declare operationQueue:Promise<unknown>|undefined;declare undoId:string|undefined;

  constructor(options:Options){
    this.o=options;this.node=options.node;this.snapshot=null;this.pending=false;this.menu=null;this.dialog=null;this.scope=null;this.expanded=new Set();this.searchOverrides=new Map();this.searchExpanded=true;
    this.treeView=installSidebarTree(this);
    this.dialogView=installSidebarDialog();
    this.menuView=installSidebarMenu(item=>{this.closeMenu(false);item.run?.();});
    this.toolbarView=installSidebarToolbar({before:this.node.parentElement!,onAll:()=>this.toggleRunning(false),onRunning:()=>this.toggleRunning(true),onRetry:()=>{void (this.o.retry?this.o.retry():this.o.refresh()).catch(e=>this.o.toast(String(e.message||e),true));},onArchive:()=>this.archiveView(false),onMore:more=>this.openMenu(more,this.toolbarMenu(more))});
    this.toolbar=this.toolbarView.node;this.progress=this.toolbarView.progress;
    this.undoView=installSidebarUndo({anchor:this.toolbar,api:path=>this.o.api(path),restore:thread=>this.run('restore',thread,{},true),focus:()=>this.focusAnchor(),error:message=>this.o.toast(message,true)});
    document.addEventListener('pointerdown',e=>{if(this.menu&&!this.menu.contains(e.target as Node)&&!this.menuAnchor?.contains(e.target as Node))this.closeMenu(false);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.menu){e.preventDefault();e.stopImmediatePropagation();this.closeMenu();}},true);
    window.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('scroll',()=>this.positionMenu());
  }
  // Persist explicit expansions so newly discovered groups also start collapsed.
  key(){return 'rcm.sidebar.expanded.'+this.o.host+'.'+(this.scope||'unknown');}
  save(){try{localStorage.setItem(this.key(),JSON.stringify([...this.expanded]));}catch{}}
  expandProject(id:string){
    this.expanded.add('project:'+id);
    const group=this.snapshot&&sidebarGroups({...this.snapshot,archived:false}).find(g=>g.items.some(i=>i.kind==='project'&&(i.value.id===id||i.value.aliasIds?.includes(id))));
    const item=group?.items.find(i=>i.kind==='project'&&(i.value.id===id||i.value.aliasIds?.includes(id)));
    if(item)this.expanded.add('project:'+item.value.id);
    this.expanded.add('section:'+(group?.id||'threads'));this.save();
  }
  toolbarMenu(more:HTMLButtonElement):MenuEntry[]{
    const unavailable=!this.o.connected()||!!this.view?.loading||this.pending;
    return [
      {label:'刷新会话',disabled:unavailable,run:()=>{more.focus({preventScroll:true});void this.o.refresh().catch(e=>this.o.toast(String(e.message||e),true));}},
      {label:'已归档',hidden:!!this.snapshot?.archived,disabled:unavailable,run:()=>{more.focus({preventScroll:true});this.archiveView(true);}},
      {label:'全部折叠',hidden:!!this.snapshot?.archived||this.running,run:()=>{this.collapseAll();more.focus({preventScroll:true});}},
      this.entry('新建分区','createSection',()=>this.edit('createSection',null,'新建分区')),
    ];
  }
  archiveView(archived:boolean){
    if(this.running)this.toggleRunning(false);
    this.toolbar?.querySelector<HTMLButtonElement>('.sidebar-more')?.focus({preventScroll:true});
    this.o.onArchiveView(archived);
  }
  toggleRunning(next=!this.running){
    if(next===this.running||next&&!this.o.connected())return;
    const scroll=this.node.parentElement!;
    if(!this.running)this.savedScroll=scroll.scrollTop;
    this.running=next;this.closeMenu(false);this.render(this.snapshot,this.view);
    scroll.scrollTop=this.running?0:this.savedScroll;
    this.toolbar?.querySelector<HTMLButtonElement>(this.running?'.sidebar-running-filter':'.sidebar-all-filter')?.focus({preventScroll:true});
  }
  waiting(t:SidebarThread):boolean{
    if(!this.o.connected())return false;
    const activity=t.activity as {needsAnswer?:boolean;observedAt?:number}|undefined;
    return !!this.o.needsAnswer?.(t.id)||!!(this.source(t)==='desktop'&&activity?.needsAnswer);
  }
  isExpanded(key:string):boolean{if(this.running)return true;return this.view?.search?(this.searchOverrides.get(key)??this.searchExpanded):this.expanded.has(key);}
  collapseAll(){this.expanded.clear();this.searchOverrides.clear();this.searchExpanded=false;this.save();this.render(this.snapshot,this.view);}
  entry(label:string,action:string,run:()=>unknown,extra:Partial<MenuEntry>={}):MenuEntry{const c=this.snapshot?.capabilities[action];return {label,run,disabled:!this.o.connected()||!c?.supported,reason:!this.o.connected()?'连接目标机器后可操作。':c?.reason,...extra,hidden:!c?.supported};}
  render(snapshot:SidebarSnapshot|null,view:View={}){
    if(this.view?.search!==view.search){this.searchOverrides.clear();this.searchExpanded=true;}
    this.view=view;if(!snapshot){this.running=false;this.runningView=null;this.runningFilter=new RunningFilter();this.renderShape=undefined;this.snapshot=null;this.closeMenu(false);this.toolbarView.setRunning({active:false,disabled:true,hidden:false,count:0,pending:false,uncertain:true,search:false});this.treeView.render([],'正在读取会话…');return;}if(this.drag){this.snapshot=snapshot;return;}
    this.snapshot=snapshot;
    if(!snapshot.archived&&!view.search&&!snapshot.nextCursor)for(const [key,t] of this.archiving||[]){
      if(key===snapshot.accountScope+':'+t.id&&!this.operations?.has(key)&&!snapshot.data.some(row=>row.id===t.id))this.archiving!.delete(key);
    }
    if(this.scope!==snapshot.accountScope){this.scope=snapshot.accountScope;this.running=false;this.savedScroll=0;try{const saved=JSON.parse(localStorage.getItem(this.key())||'[]');this.expanded=new Set(Array.isArray(saved)?saved.filter(k=>typeof k==='string'):[]);}catch{this.expanded=new Set();}this.searchOverrides.clear();this.searchExpanded=true;this.closeMenu(false);this.undoView?.hide();}
    this.toolbarView.setArchived(snapshot.archived);
    const display=this.archiveDisplay(snapshot);
    if(snapshot.archived)this.running=false;
    this.runningView=this.runningFilter.read(display,{connected:this.o.connected(),source:t=>this.source(t),waiting:t=>this.waiting(t),failed:view.failed});
    this.toolbarView.setRunning({active:this.running,disabled:!this.o.connected()&&!this.running,hidden:!!snapshot.archived,count:this.runningView.count,pending:this.runningView.pending,uncertain:this.runningView.uncertain,search:!!view.search});
    const shape=JSON.stringify([display,this.running,this.runningView.rows.map(r=>[r.thread.id,r.waiting,r.uncertain]),this.runningView.pending,this.runningView.uncertain,view.failed,view.search,display.data.length?false:view.loading,this.o.selectedId(),this.o.connected(),[...this.expanded],[...this.searchOverrides],this.searchExpanded,display.data.map(t=>[this.source(t),this.waiting(t),this.o.relativeTime(t.recencyAt||t.updatedAt)])],(key,value)=>key==='observedAt'?undefined:value);
    if(shape===this.renderShape){this.setBusy(this.pending);return;}
    this.renderShape=shape;
    const focused=(document.activeElement as HTMLElement|null)?.dataset?.focusKey,scroll=this.node.parentElement!.scrollTop;
    const groups=this.running?(this.runningView.rows.length?[{id:'running',name:'运行中',items:this.runningView.rows.map(row=>({kind:'thread' as const,value:row.thread}))}]:[]):sidebarGroups(display);
    const empty=this.running?(this.runningView.pending?'正在确认运行状态…':this.runningView.uncertain?'运行状态待确认':view.search?'没有匹配的运行会话':'当前没有正在运行的会话'):view.loading?'正在读取…':view.search?'没有匹配的会话':snapshot.archived?'暂无已归档会话':'暂无会话';
    this.treeView.render(groups,empty);
    if(focused)[...this.node.querySelectorAll<HTMLElement>('[data-focus-key]')].find(n=>n.dataset.focusKey===focused)?.focus({preventScroll:true});
    this.node.parentElement!.scrollTop=scroll;this.setBusy(this.pending);
  }
  archiveDisplay(snapshot:SidebarSnapshot){
    if(snapshot.archived||!this.archiving?.size)return snapshot;
    return {...snapshot,data:snapshot.data.filter(t=>!this.archiving!.has(snapshot.accountScope+':'+t.id))};
  }
  setBusy(pending:boolean){
    this.node.setAttribute('aria-busy',String(pending));this.progress.hidden=!pending;
    this.treeView.setBusy();
  }
  // Queue only native mutations; a slow list refresh must not block the next item.
  enqueue<T>(work:()=>T|Promise<T>):Promise<T>{
    const next=(this.operationQueue||Promise.resolve()).then(work);
    this.operationQueue=next.catch(()=>{});return next;
  }

  toggle(key:string){if(this.view?.search)this.searchOverrides.set(key,!this.isExpanded(key));else{if(this.expanded.has(key))this.expanded.delete(key);else this.expanded.add(key);this.save();}this.render(this.snapshot,this.view);}
  source(t:SidebarThread):string|null{return this.o.activitySource?this.o.activitySource(t):activitySource(t,{connected:this.o.connected(),webActive:(t.status as {type?:string}|undefined)?.type==='active'});}
  threadMenu(t:SidebarThread):MenuEntry[]{
    if(this.operations?.has(this.snapshot!.accountScope+':'+t.id))return [{label:'正在处理此会话…',disabled:true}];
    if(t.archived)return [this.entry('恢复会话','restore',()=>this.run('restore',t))];
    const entries=[this.entry('重命名','rename',()=>this.edit('rename',t,'重命名会话',t.name)),this.entry(t.isPinned?'取消置顶':'置顶','pin',()=>this.run('pin',t,{pinned:!t.isPinned})),this.entry('移动到项目','moveProject',()=>this.choose('moveProject',t)),this.entry('移动到分区','moveSection',()=>this.choose('moveSection',t)),this.entry(t.isUnread?'标记已读':'标记未读','read',()=>this.run('read',t,{read:!!t.isUnread}),{disabled:!this.o.connected()||!t.readRevision||!this.snapshot!.capabilities.read.supported,reason:this.snapshot!.capabilities.read.reason})];
    if(t.isPinned&&this.snapshot!.preferences.pinned==='manual'){
      const peers=this.snapshot!.data.filter(x=>x.sectionId===t.sectionId).sort((a,b)=>(a.sectionPosition??Infinity)-(b.sectionPosition??Infinity)||a.id.localeCompare(b.id));const index=peers.findIndex(x=>x.id===t.id);
      if(index>0)entries.push(this.entry('上移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index-1].id})));
      if(index<peers.length-1)entries.push(this.entry('下移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index+2]?.id??null})));
    }
    entries.push(this.entry('归档会话','archive',()=>this.run('archive',t),(t.status as {type?:string}|undefined)?.type==='active'?{disabled:true,reason:'会话正在运行，请结束后再归档。'}:{}));return entries;
  }
  sectionMenu(s:SidebarSection){return [this.entry('重命名分区','renameSection',()=>this.edit('renameSection',s,'重命名分区',s.name)),this.entry('删除分区','deleteSection',()=>this.confirmDelete(s))];}
  openMenu(anchor:HTMLElement,entries:MenuEntry[]){
    this.closeMenu(false);entries=entries.filter(item=>!item.hidden);if(!entries.length)return;this.menuAnchor=anchor;
    const menu=this.menuView.open(entries);this.menu=menu;this.positionMenu(true);menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  closeMenu(restore=true){if(!this.menu)return;this.menuView.close();this.menu=null;if(restore)this.menuAnchor?.focus();}

  positionMenu(initial=false){
    if(!this.menu)return;
    const rect=this.menuAnchor!.getBoundingClientRect(),v=window.visualViewport,top=v?.offsetTop||0,height=v?.height||innerHeight;
    this.menu.style.maxHeight=Math.max(44,height-16)+'px';
    const width=this.menu.offsetWidth;
    // A newly mounted menu has no left constraint. Its clamped destination
    // keeps its measured width under the current width limits; read dimensions before
    // positioning. Existing menus still remeasure after left changes on resize.
    const initialHeight=initial&&!this.menu.style.left?this.menu.offsetHeight:null;
    this.menu.style.left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8))+'px';
    this.menu.style.top=Math.max(top+8,Math.min(rect.bottom,top+height-(initialHeight??this.menu.offsetHeight)-8))+'px';
  }
  openDialog(options:Omit<Parameters<ReturnType<typeof installReactSidebarDialog>["open"]>[0],"accountScope"|"closed">){
    const view=this.dialogView.open({...options,accountScope:this.snapshot!.accountScope||'',closed:()=>{this.dialog=null;this.focusAnchor();}});
    this.dialog=view.dialog;view.show();
  }
  edit(action:string,target:Target,title:string,value=''){
    this.openDialog({title,field:{kind:'text',label:title,value:value||''},execute:name=>this.run(action,target,{name},true)});
  }
  choose(action:string,target:SidebarThread){
    const project=action==='moveProject';
    this.openDialog({title:project?'移动到项目':'移动到分区',field:{kind:'select',label:project?'项目':'分区',value:(project?target.projectId:target.sectionId)||'',options:[{name:project?'不关联项目':'移出分区',id:''},...(project?this.snapshot!.projects:this.snapshot!.sections)]},execute:value=>this.run(action,target,{[project?'projectId':'sectionId']:value||null},true)});
  }
  confirmDelete(section:SidebarSection){this.openDialog({title:'删除分区',field:{kind:'message',text:'删除“'+section.name+'”分区，其中的会话和项目会保留。'},submitLabel:'删除分区',execute:()=>this.run('deleteSection',section,{},true)});}
  focusAnchor(){const key=this.menuAnchor?.dataset.focusKey;[...this.node.querySelectorAll<HTMLElement>('[data-focus-key]')].find(n=>n.dataset.focusKey===key)?.focus({preventScroll:true});if(!document.activeElement||document.activeElement===document.body)this.node.querySelector('button')?.focus({preventScroll:true});}
  async run(action:string,target:Target,extra:Record<string,unknown>={},propagate=false){
    const scope=this.snapshot!.accountScope,key=scope+':'+(target?.id||action);
    this.operations??=new Map();
    if(this.operations.has(key)){if(propagate)throw Error('此项正在处理，请等待完成。');return;}
    if(this.dialog&&this.dialog.dataset.accountScope!==(scope||''))throw Error('目标账号已变化，请取消后刷新；输入内容已保留。');
    const anchor=this.menuAnchor,dialog=propagate?this.dialog:null;
    if(dialog)dialog.dataset.busy='true';
    this.operations.set(key,action);this.pending=true;this.setBusy(true);
    this.archiving??=new Map();
    if(action==='archive'){this.archiving.set(key,target as SidebarThread);this.render(this.snapshot,this.view);}
    if(action==='restore')this.archiving!.delete(key);
    const current=()=>this.snapshot!.accountScope===scope;

    const label=action==='archive'?'正在归档会话…':action==='restore'?'正在恢复会话…':'正在更新…';
    this.progress.textContent=label;
    let started=false;
    const slow=setTimeout(()=>{if(!current())return;this.progress.textContent=started?'仍在等待目标机器…':'已排队，等待前面的操作完成…';},5000);
    let completed=false;
    try{await this.enqueue(()=>{if(!current()||!this.o.connected())throw Error('连接或账号已变化，未执行排队操作。');started=true;this.progress.textContent=label;return this.o.api('/api/sidebar/actions',{method:'POST',body:{action,id:target?.id,expectedRevision:target?.revision,accountScope:scope,...extra}});});
      if(!current())return;
      completed=true;clearTimeout(slow);
      this.progress.textContent='正在刷新列表…';
      await this.o.changed(action,target);
      if(!current())return;
      if(action==='archive'){if(!this.snapshot!.archived&&!this.snapshot!.data?.some(t=>t.id===target!.id))this.archiving!.delete(key);this.undo(target!.id);}if(action==='restore'&&this.undoId===target!.id)this.undoView?.hide();
    }catch(caught){
      let error=caught as Error & {code?:string};
      // Show the outcome before another potentially slow remote read.
      clearTimeout(slow);
      if(!current())return;
      if(action==='archive'&&!completed&&error.code!=='DESKTOP_SYNC_FAILED'){this.archiving!.delete(key);this.render(this.snapshot,this.view);}
      if(completed)error=new Error('操作已完成，但刷新失败：'+error.message,{cause:error});
      if(!propagate)this.o.toast(error.message,true);
      void this.o.refresh().catch(()=>{});
      if(propagate)throw error;
    }
    finally{clearTimeout(slow);if(!current())this.archiving!.delete(key);this.operations.delete(key);this.pending=this.operations.size>0;this.setBusy(this.pending);this.progress.textContent=this.pending?'正在处理会话…':'正在更新…';if(dialog)dialog.dataset.busy='false';if(!this.dialog&&globalThis.document?.activeElement===globalThis.document?.body&&this.menuAnchor===anchor)this.focusAnchor();}
  }

  undo(id:string){this.undoId=id;this.undoView.show(id,this.snapshot!.accountScope);}

}

let sidebarMenuInstaller:typeof installReactSidebarMenu|undefined;
export function configureSidebarMenu(installer:typeof installReactSidebarMenu){sidebarMenuInstaller=installer;}
export function installSidebarMenu(select:Parameters<typeof installReactSidebarMenu>[0]){
  if(!sidebarMenuInstaller)throw new Error('侧栏菜单尚未初始化。');
  return sidebarMenuInstaller(select);
}

let sidebarDialogInstaller:typeof installReactSidebarDialog|undefined;
export function configureSidebarDialog(installer:typeof installReactSidebarDialog){sidebarDialogInstaller=installer;}
export function installSidebarDialog(){
  if(!sidebarDialogInstaller)throw new Error('侧栏弹窗尚未初始化。');
  return sidebarDialogInstaller();
}

let sidebarUndoInstaller:typeof installReactSidebarUndo|undefined;
export function configureSidebarUndo(installer:typeof installReactSidebarUndo){sidebarUndoInstaller=installer;}
export function installSidebarUndo(options:Parameters<typeof installReactSidebarUndo>[0]){
  if(!sidebarUndoInstaller)throw new Error('侧栏归档撤销尚未初始化。');
  return sidebarUndoInstaller(options);
}

let sidebarToolbarInstaller:typeof installReactSidebarToolbar|undefined;
export function configureSidebarToolbar(installer:typeof installReactSidebarToolbar){sidebarToolbarInstaller=installer;}
export function installSidebarToolbar(options:Parameters<typeof installReactSidebarToolbar>[0]){
  if(!sidebarToolbarInstaller)throw new Error('侧栏工具栏尚未初始化。');
  return sidebarToolbarInstaller(options);
}

let sidebarTreeInstaller:typeof installReactSidebarTree|undefined;
export function configureSidebarTree(installer:typeof installReactSidebarTree){sidebarTreeInstaller=installer;}
export function installSidebarTree(controller:Parameters<typeof installReactSidebarTree>[0]){
  if(!sidebarTreeInstaller)throw new Error('侧栏树尚未初始化。');
  return sidebarTreeInstaller(controller);
}
