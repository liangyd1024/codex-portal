import {activitySource,activityIcon,threadSourceIcon,questionActivityIcon} from './activity.js';
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function orderItems(items,keys=[],orderedThreadIds=null){
  const rank=new Map(keys.map((key,i)=>[key,i]));
  const result=[...items].sort((a,b)=>(rank.get(a.kind+':'+a.value.id)??Infinity)-(rank.get(b.kind+':'+b.value.id)??Infinity));
  if(orderedThreadIds){const byId=new Map(result.filter(i=>i.kind==='thread').map(i=>[i.value.id,i]));const ordered=orderedThreadIds.flatMap(id=>byId.has(id)?[byId.get(id)]:[]);let index=0;return result.map(i=>i.kind==='thread'?ordered[index++]||i:i);}
  return result;
}
// Collapse only the presentation. Native project IDs and thread membership stay intact.
const rootKey=roots=>Array.isArray(roots)&&roots.length&&roots.every(r=>typeof r==='string'&&r.startsWith('/'))?JSON.stringify([...new Set(roots.map(r=>r.replace(/\/+$/,'')||'/'))].sort()):null;
export function projectFolderOptions(projects){
  const seen=new Set();
  return projects.flatMap(p=>(p.roots||[]).filter(root=>typeof root==='string'&&root.startsWith('/')).flatMap(root=>{
    const key=root.replace(/\/+$/,'')||'/';
    if(seen.has(key))return [];seen.add(key);return [{root,name:p.name||key.split('/').pop()||'/'}];
  }));
}
function projectPresentation(snapshot){
  const preferred=[...snapshot.pinnedProjectIds,...snapshot.sections.flatMap(s=>s.projectIds),...snapshot.projects.filter(p=>p.legacyId&&p.legacyId!==p.id).map(p=>p.id),...snapshot.rootProjectIds];
  const rank=new Map();preferred.forEach((id,i)=>{if(!rank.has(id))rank.set(id,i);});
  const groups=new Map(),aliases=new Map();
  for(const p of snapshot.projects){const key=rootKey(p.roots)||'id:'+p.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  const projects=[];
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
  const ids=values=>[...new Set(values.map(id=>aliases.get(id)||id))];
  const keys=values=>(values||[]).map(key=>key.startsWith('project:')?'project:'+(aliases.get(key.slice(8))||key.slice(8)):key);
  return {...snapshot,projects,pinnedProjectIds:ids(snapshot.pinnedProjectIds),rootProjectIds:ids(snapshot.rootProjectIds),pinnedOrder:keys(snapshot.pinnedOrder),sections:snapshot.sections.map(s=>({...s,projectIds:ids(s.projectIds),itemOrder:keys(s.itemOrder)}))};
}
export function sidebarGroups(snapshot){
  snapshot=projectPresentation(snapshot);
  const threads=new Map(snapshot.data.map(t=>[t.id,t])),projects=new Map(snapshot.projects.map(p=>[p.id,p]));
  const seenThreads=new Set(),seenProjects=new Set();
  const thread=ids=>ids.filter(id=>threads.has(id)&&!seenThreads.has(id)&&seenThreads.add(id)).map(id=>({kind:'thread',value:threads.get(id)}));
  const project=ids=>ids.filter(id=>projects.has(id)&&!seenProjects.has(id)&&seenProjects.add(id)).map(id=>({kind:'project',value:projects.get(id),children:thread(projects.get(id).threadIds)}));
  if(snapshot.archived)return [{id:'archive',name:'已归档',items:thread(snapshot.data.map(t=>t.id))}];
  const pinnedThreads=thread(snapshot.pinnedThreadIds);
  let pinned=[...project(snapshot.pinnedProjectIds),...pinnedThreads];
  if(snapshot.preferences?.pinned==='updated_at')pinned.sort((a,b)=>(b.value.recencyAt||b.value.updatedAt||0)-(a.value.recencyAt||a.value.updatedAt||0)||a.value.id.localeCompare(b.value.id));
  else pinned=orderItems(pinned,snapshot.pinnedOrder,snapshot.pinnedThreadIds);
  const groups=[{id:'pinned',name:'置顶',items:pinned}];
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
  constructor(options){
    this.o=options;this.node=options.node;this.snapshot=null;this.pending=false;this.menu=null;this.dialog=null;this.scope=null;this.expanded=new Set();this.searchOverrides=new Map();this.searchExpanded=true;
    this.dialogView=installSidebarDialog();
    this.menuView=installSidebarMenu(item=>{this.closeMenu(false);item.run?.();});
    this.toolbar=make('div','sidebar-tools');
    const archive=make('button','sidebar-view','已归档');archive.type='button';archive.onclick=()=>options.onArchiveView(!this.snapshot?.archived);this.archiveButton=archive;
    const more=make('button','icon-button','⋯');more.type='button';more.setAttribute('aria-label','侧边栏设置');more.onclick=()=>this.openMenu(more,[
      {label:'全部折叠',run:()=>{this.collapseAll();more.focus({preventScroll:true});}},
      this.entry('新建分区','createSection',()=>this.edit('createSection',null,'新建分区')),
    ]);
    this.progress=make('span','sidebar-progress','正在更新…');this.progress.setAttribute('role','status');this.progress.hidden=true;this.toolbar.append(archive,this.progress,more);options.node.before(this.toolbar);
    this.undoView=installSidebarUndo({anchor:this.toolbar,api:path=>this.o.api(path),restore:thread=>this.run('restore',thread,{},true),focus:()=>this.focusAnchor(),error:message=>this.o.toast(message,true)});
    document.addEventListener('pointerdown',e=>{if(this.menu&&!this.menu.contains(e.target)&&!this.menuAnchor?.contains(e.target))this.closeMenu(false);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.menu){e.preventDefault();e.stopImmediatePropagation();this.closeMenu();}},true);
    window.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('scroll',()=>this.positionMenu());
  }
  // Persist explicit expansions so newly discovered groups also start collapsed.
  key(){return 'rcm.sidebar.expanded.'+this.o.host+'.'+(this.scope||'unknown');}
  save(){try{localStorage.setItem(this.key(),JSON.stringify([...this.expanded]));}catch{}}
  expandProject(id){
    this.expanded.add('project:'+id);
    const group=this.snapshot&&sidebarGroups({...this.snapshot,archived:false}).find(g=>g.items.some(i=>i.kind==='project'&&(i.value.id===id||i.value.aliasIds?.includes(id))));
    const item=group?.items.find(i=>i.kind==='project'&&(i.value.id===id||i.value.aliasIds?.includes(id)));
    if(item)this.expanded.add('project:'+item.value.id);
    this.expanded.add('section:'+(group?.id||'threads'));this.save();
  }
  isExpanded(key){return this.view?.search?(this.searchOverrides.get(key)??this.searchExpanded):this.expanded.has(key);}
  collapseAll(){this.expanded.clear();this.searchOverrides.clear();this.searchExpanded=false;this.save();this.render(this.snapshot,this.view);}
  entry(label,action,run,extra={}){const c=this.snapshot?.capabilities[action];return {label,run,disabled:!this.o.connected()||!c?.supported,reason:!this.o.connected()?'连接目标机器后可操作。':c?.reason,...extra,hidden:!c?.supported};}
  render(snapshot,view={}){
    if(this.view?.search!==view.search){this.searchOverrides.clear();this.searchExpanded=true;}
    this.view=view;if(!snapshot)return;if(this.drag){this.snapshot=snapshot;return;}
    this.snapshot=snapshot;
    if(!snapshot.archived&&!view.search&&!snapshot.nextCursor)for(const [key,t] of this.archiving||[]){
      if(key===snapshot.accountScope+':'+t.id&&!this.operations?.has(key)&&!snapshot.data.some(row=>row.id===t.id))this.archiving.delete(key);
    }
    if(this.scope!==snapshot.accountScope){this.scope=snapshot.accountScope;try{const saved=JSON.parse(localStorage.getItem(this.key())||'[]');this.expanded=new Set(Array.isArray(saved)?saved.filter(k=>typeof k==='string'):[]);}catch{this.expanded=new Set();}this.searchOverrides.clear();this.searchExpanded=true;this.closeMenu(false);this.undoView?.hide();}
    this.archiveButton.textContent=snapshot.archived?'返回会话':'已归档';this.archiveButton.setAttribute('aria-pressed',String(snapshot.archived));
    const display=this.archiveDisplay(snapshot);
    const shape=JSON.stringify([display,view.search,display.data.length?false:view.loading,this.o.selectedId(),this.o.connected(),[...this.expanded],[...this.searchOverrides],this.searchExpanded,display.data.map(t=>[this.source(t),this.o.needsAnswer?.(t.id),this.o.relativeTime(t.recencyAt||t.updatedAt)])],(key,value)=>key==='observedAt'?undefined:value);
    if(shape===this.renderShape){this.setBusy(this.pending);return;}
    this.renderShape=shape;
    const focused=document.activeElement?.dataset?.focusKey,scroll=this.node.parentElement.scrollTop;
    this.node.replaceChildren();
    for(const group of sidebarGroups(display)){
      const items=group.items.filter(i=>!view.search||i.kind==='thread'||i.children.length);
      if(view.search&&!items.length)continue;
      const wrap=make('section','sidebar-group'),header=make('div','sidebar-group-heading');
      const disclosure=make('button','sidebar-section-button');disclosure.type='button';disclosure.dataset.focusKey='section:'+group.id;
      const expanded=this.isExpanded('section:'+group.id);disclosure.setAttribute('aria-expanded',String(expanded));disclosure.append(this.o.icon('chevron'),make('span','sidebar-section-name',group.name));
      this.renderActivity(disclosure,group.items);
      const children=make('div','sidebar-group-items');children.id='sidebar-section-'+group.id;children.hidden=!expanded;disclosure.setAttribute('aria-controls',children.id);
      disclosure.onclick=()=>{this.toggle('section:'+group.id);};this.disclosureKeys(disclosure,'section:'+group.id);header.append(disclosure);
      if(group.section)this.addMenu(header,disclosure,()=>this.sectionMenu(group.section));
      for(const item of items)if(item.kind==='project')this.renderProject(children,item);else this.renderThread(children,item.value);
      if(!items.length)children.append(make('p','project-empty','暂无会话或项目'));
      wrap.append(header,children);this.node.append(wrap);
    }
    if(!this.node.childElementCount)this.node.append(make('p','sidebar-empty',view.loading?'正在读取…':view.search?'没有匹配的会话':snapshot.archived?'暂无已归档会话':'暂无会话'));
    if(focused)[...this.node.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===focused)?.focus({preventScroll:true});
    this.node.parentElement.scrollTop=scroll;this.setBusy(this.pending);
  }
  archiveDisplay(snapshot){
    if(snapshot.archived||!this.archiving?.size)return snapshot;
    return {...snapshot,data:snapshot.data.filter(t=>!this.archiving.has(snapshot.accountScope+':'+t.id))};
  }
  setBusy(pending){
    this.node.setAttribute('aria-busy',String(pending));this.progress.hidden=!pending;
    this.archiveButton.disabled=false;this.toolbar.querySelector('.icon-button').disabled=false;
    for(const b of this.node.querySelectorAll('.sidebar-item-menu')){
      const id=b.dataset.focusKey?.replace(/^menu:thread:/,'');
      b.disabled=!!this.operations?.has(this.snapshot.accountScope+':'+id);
      b.setAttribute('aria-busy',String(b.disabled));
    }
  }
  // Queue only native mutations; a slow list refresh must not block the next item.
  enqueue(work){
    const next=(this.operationQueue||Promise.resolve()).then(work);
    this.operationQueue=next.catch(()=>{});return next;
  }

  toggle(key){if(this.view?.search)this.searchOverrides.set(key,!this.isExpanded(key));else{if(this.expanded.has(key))this.expanded.delete(key);else this.expanded.add(key);this.save();}this.render(this.snapshot,this.view);}
  disclosureKeys(button,key){button.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(this.isExpanded(key)!==(e.key==='ArrowRight'))this.toggle(key);}});}
  source(t){return this.o.activitySource?this.o.activitySource(t):activitySource(t,{connected:this.o.connected(),webActive:t.status?.type==='active'});}
  renderActivity(parent,items){
    const counts=new Map();let waiting=0;
    const visit=item=>{if(item.kind==='project'){item.children.forEach(visit);return;}if(this.o.needsAnswer?.(item.value.id)){waiting++;return;}const source=this.source(item.value);if(source)counts.set(source,(counts.get(source)||0)+1);};
    items.forEach(visit);
    if(waiting){const badge=questionActivityIcon(this.o.icon);badge.title=waiting+' 个会话需要你回答';badge.setAttribute('aria-label',badge.title);badge.append(make('span','question-count',String(waiting)));parent.append(badge);}
    if(!counts.size)return;
    const total=[...counts.values()].reduce((sum,count)=>sum+count,0);
    const badge=activityIcon(counts.has('web')?'web':'desktop',this.o.icon);
    badge.className='activity-icon activity-running activity-summary';
    badge.replaceChildren(make('span','',String(total)));
    badge.title=total+' 个会话运行中（'+[counts.has('web')?'网页端 '+counts.get('web'):'',counts.has('desktop')?'桌面端 '+counts.get('desktop'):''].filter(Boolean).join('，')+'）';
    badge.setAttribute('aria-label',badge.title);parent.append(badge);
  }
  renderProject(parent,item){
    const p=item.value,group=make('div','project-group'),header=make('div','project-heading');
    const button=make('button','project-button');button.type='button';button.dataset.projectId=p.id;button.dataset.focusKey='project:'+p.id;button.title=p.roots.join('\n');
    const expanded=this.isExpanded('project:'+p.id);button.setAttribute('aria-expanded',String(expanded));button.append(this.o.icon('chevron','project-chevron'),this.o.icon('folder'),make('span','project-name',p.name));
    this.renderActivity(button,item.children);
    const children=make('div','project-threads');children.id='sidebar-project-'+p.id;children.hidden=!expanded;button.setAttribute('aria-controls',children.id);button.onclick=()=>this.toggle('project:'+p.id);this.disclosureKeys(button,'project:'+p.id);header.append(button);
    const create=make('button','sidebar-project-create');create.type='button';
    create.dataset.focusKey='create:project:'+p.id;create.title='在项目中新建会话：'+p.name;create.setAttribute('aria-label',create.title);
    create.disabled=!this.o.connected()||!p.roots[0];create.append(this.o.icon('plus'));
    create.onclick=()=>{if(!this.o.connected()||!p.roots[0])return;this.closeMenu(false);this.o.newThread(p.roots[0]);};header.append(create);
    for(const child of item.children)this.renderThread(children,child.value);
    if(!item.children.length)children.append(make('p','project-empty','暂无会话'));
    group.append(header,children);parent.append(group);
  }
  renderThread(parent,t){
    const row=make('div','sidebar-thread'),button=make('button','thread-row'+(this.o.selectedId()===t.id?' selected':''));button.type='button';button.dataset.threadId=t.id;button.dataset.focusKey='thread:'+t.id;button.title=this.o.threadName(t);
    if(this.o.selectedId()===t.id)button.setAttribute('aria-current','true');
    const title=make('div','thread-name');if(t.isUnread){const dot=make('span','thread-unread');dot.setAttribute('aria-label','未读');title.append(dot);}title.append(make('span','',this.o.threadName(t)));
    const source=this.source(t);
    title.append(threadSourceIcon(t,source,this.o.icon,this.o.needsAnswer?.(t.id)));
    const meta=make('div','thread-meta');meta.append(make('span','thread-time',this.o.relativeTime(t.recencyAt||t.updatedAt)));button.append(title,meta);button.onclick=()=>this.o.select(t);
    row.append(button);this.addMenu(row,button,()=>this.threadMenu(t));
    const manual=t.isPinned&&this.snapshot.preferences.pinned==='manual'&&this.snapshot.capabilities.reorderThread.supported;
    if(manual&&!this.snapshot.archived){button.draggable=true;button.ondragstart=e=>{if(this.pending){e.preventDefault();return;}this.drag=t;e.dataTransfer.setData('text/plain',t.id);};button.ondragend=()=>{this.drag=null;this.render(this.snapshot,this.view);};button.ondragover=e=>{if(this.drag&&this.drag.id!==t.id&&this.drag.sectionId===t.sectionId)e.preventDefault();};button.ondrop=e=>{e.preventDefault();if(this.drag?.sectionId===t.sectionId&&this.drag.id!==t.id)this.run('reorderThread',this.drag,{beforeThreadId:t.id});this.drag=null;};}
    parent.append(row);
  }
  addMenu(container,anchor,entries){
    if(!entries().some(item=>!item.hidden))return;
    const more=make('button','sidebar-item-menu','⋯');more.type='button';more.setAttribute('aria-label','更多操作：'+(anchor.title||anchor.textContent));more.dataset.focusKey='menu:'+anchor.dataset.focusKey;
    const open=e=>{e.preventDefault();this.openMenu(more,entries());};more.onclick=open;anchor.oncontextmenu=open;
    anchor.onkeydown=e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)open(e);};container.append(more);
  }
  threadMenu(t){
    if(this.operations?.has(this.snapshot.accountScope+':'+t.id))return [{label:'正在处理此会话…',disabled:true}];
    if(t.archived)return [this.entry('恢复会话','restore',()=>this.run('restore',t))];
    const entries=[this.entry('重命名','rename',()=>this.edit('rename',t,'重命名会话',t.name)),this.entry(t.isPinned?'取消置顶':'置顶','pin',()=>this.run('pin',t,{pinned:!t.isPinned})),this.entry('移动到项目','moveProject',()=>this.choose('moveProject',t)),this.entry('移动到分区','moveSection',()=>this.choose('moveSection',t)),this.entry(t.isUnread?'标记已读':'标记未读','read',()=>this.run('read',t,{read:!!t.isUnread}),{disabled:!this.o.connected()||!t.readRevision||!this.snapshot.capabilities.read.supported,reason:this.snapshot.capabilities.read.reason})];
    if(t.isPinned&&this.snapshot.preferences.pinned==='manual'){
      const peers=this.snapshot.data.filter(x=>x.sectionId===t.sectionId).sort((a,b)=>(a.sectionPosition??Infinity)-(b.sectionPosition??Infinity)||a.id.localeCompare(b.id));const index=peers.findIndex(x=>x.id===t.id);
      if(index>0)entries.push(this.entry('上移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index-1].id})));
      if(index<peers.length-1)entries.push(this.entry('下移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index+2]?.id??null})));
    }
    entries.push(this.entry('归档会话','archive',()=>this.run('archive',t),t.status?.type==='active'?{disabled:true,reason:'会话正在运行，请结束后再归档。'}:{}));return entries;
  }
  sectionMenu(s){return [this.entry('重命名分区','renameSection',()=>this.edit('renameSection',s,'重命名分区',s.name)),this.entry('删除分区','deleteSection',()=>this.confirmDelete(s))];}
  openMenu(anchor,entries){
    this.closeMenu(false);entries=entries.filter(item=>!item.hidden);if(!entries.length)return;this.menuAnchor=anchor;
    const menu=this.menuView.open(entries);this.menu=menu;this.positionMenu();menu.querySelector('button:not(:disabled)')?.focus();
  }
  closeMenu(restore=true){if(!this.menu)return;this.menuView.close();this.menu=null;if(restore)this.menuAnchor?.focus();}

  positionMenu(){
    if(!this.menu)return;
    const rect=this.menuAnchor.getBoundingClientRect(),v=window.visualViewport,top=v?.offsetTop||0,height=v?.height||innerHeight;
    this.menu.style.maxHeight=Math.max(44,height-16)+'px';
    this.menu.style.left=Math.max(8,Math.min(rect.right-this.menu.offsetWidth,innerWidth-this.menu.offsetWidth-8))+'px';
    this.menu.style.top=Math.max(top+8,Math.min(rect.bottom,top+height-this.menu.offsetHeight-8))+'px';
  }
  openDialog(options){
    const view=this.dialogView.open({...options,accountScope:this.snapshot.accountScope||'',closed:()=>{this.dialog=null;this.focusAnchor();}});
    this.dialog=view.dialog;view.show();
  }
  edit(action,target,title,value=''){
    this.openDialog({title,field:{kind:'text',label:title,value:value||''},execute:name=>this.run(action,target,{name},true)});
  }
  choose(action,target){
    const project=action==='moveProject';
    this.openDialog({title:project?'移动到项目':'移动到分区',field:{kind:'select',label:project?'项目':'分区',value:(project?target.projectId:target.sectionId)||'',options:[{name:project?'不关联项目':'移出分区',id:''},...(project?this.snapshot.projects:this.snapshot.sections)]},execute:value=>this.run(action,target,{[project?'projectId':'sectionId']:value||null},true)});
  }
  confirmDelete(section){this.openDialog({title:'删除分区',field:{kind:'message',text:'删除“'+section.name+'”分区，其中的会话和项目会保留。'},submitLabel:'删除分区',execute:()=>this.run('deleteSection',section,{},true)});}
  focusAnchor(){const key=this.menuAnchor?.dataset.focusKey;[...this.node.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===key)?.focus({preventScroll:true});if(!document.activeElement||document.activeElement===document.body)this.node.querySelector('button')?.focus({preventScroll:true});}
  async run(action,target,extra={},propagate=false){
    const scope=this.snapshot.accountScope,key=scope+':'+(target?.id||action);
    this.operations??=new Map();
    if(this.operations.has(key)){if(propagate)throw Error('此项正在处理，请等待完成。');return;}
    if(this.dialog&&this.dialog.dataset.accountScope!==(scope||''))throw Error('目标账号已变化，请取消后刷新；输入内容已保留。');
    const anchor=this.menuAnchor,dialog=propagate?this.dialog:null;
    if(dialog)dialog.dataset.busy='true';
    this.operations.set(key,action);this.pending=true;this.setBusy(true);
    this.archiving??=new Map();
    if(action==='archive'){this.archiving.set(key,target);this.render(this.snapshot,this.view);}
    if(action==='restore')this.archiving.delete(key);
    const current=()=>this.snapshot.accountScope===scope;

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
      if(action==='archive'){if(!this.snapshot.archived&&!this.snapshot.data?.some(t=>t.id===target.id))this.archiving.delete(key);this.undo(target.id);}if(action==='restore'&&this.undoId===target.id)this.undoView?.hide();
    }catch(error){
      // Show the outcome before another potentially slow remote read.
      clearTimeout(slow);
      if(!current())return;
      if(action==='archive'&&!completed&&error.code!=='DESKTOP_SYNC_FAILED'){this.archiving.delete(key);this.render(this.snapshot,this.view);}
      if(completed)error=new Error('操作已完成，但刷新失败：'+error.message,{cause:error});
      if(!propagate)this.o.toast(error.message,true);
      void this.o.refresh().catch(()=>{});
      if(propagate)throw error;
    }
    finally{clearTimeout(slow);if(!current())this.archiving.delete(key);this.operations.delete(key);this.pending=this.operations.size>0;this.setBusy(this.pending);this.progress.textContent=this.pending?'正在处理会话…':'正在更新…';if(dialog)dialog.dataset.busy='false';if(!this.dialog&&globalThis.document?.activeElement===globalThis.document?.body&&this.menuAnchor===anchor)this.focusAnchor();}
  }

  undo(id){this.undoId=id;this.undoView.show(id,this.snapshot.accountScope);}

}

let sidebarMenuInstaller;
export function configureSidebarMenu(installer){sidebarMenuInstaller=installer;}
export function installSidebarMenu(select){
  if(!sidebarMenuInstaller)throw new Error('侧栏菜单尚未初始化。');
  return sidebarMenuInstaller(select);
}

let sidebarDialogInstaller;
export function configureSidebarDialog(installer){sidebarDialogInstaller=installer;}
export function installSidebarDialog(){
  if(!sidebarDialogInstaller)throw new Error('侧栏弹窗尚未初始化。');
  return sidebarDialogInstaller();
}

let sidebarUndoInstaller;
export function configureSidebarUndo(installer){sidebarUndoInstaller=installer;}
export function installSidebarUndo(options){
  if(!sidebarUndoInstaller)throw new Error('侧栏归档撤销尚未初始化。');
  return sidebarUndoInstaller(options);
}
