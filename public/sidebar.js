const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function orderItems(items,keys=[],orderedThreadIds=null){
  const rank=new Map(keys.map((key,i)=>[key,i]));
  const result=[...items].sort((a,b)=>(rank.get(a.kind+':'+a.value.id)??Infinity)-(rank.get(b.kind+':'+b.value.id)??Infinity));
  if(orderedThreadIds){const byId=new Map(result.filter(i=>i.kind==='thread').map(i=>[i.value.id,i]));const ordered=orderedThreadIds.flatMap(id=>byId.has(id)?[byId.get(id)]:[]);let index=0;return result.map(i=>i.kind==='thread'?ordered[index++]||i:i);}
  return result;
}
export function sidebarGroups(snapshot){
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
    this.o=options;this.node=options.node;this.snapshot=null;this.pending=false;this.menu=null;this.dialog=null;this.scope=null;this.collapsed=new Set();
    this.toolbar=make('div','sidebar-tools');
    const archive=make('button','sidebar-view','已归档');archive.type='button';archive.onclick=()=>options.onArchiveView(!this.snapshot?.archived);this.archiveButton=archive;
    const more=make('button','icon-button','⋯');more.type='button';more.setAttribute('aria-label','侧边栏设置');more.onclick=()=>this.openMenu(more,[
      this.entry('新建分区','createSection',()=>this.edit('createSection',null,'新建分区')),
      {label:'排序：'+(this.snapshot?.preferences.chats==='manual'?'手动':'最近更新'),disabled:true,reason:this.snapshot?.capabilities.preferences.reason},
      {label:'调整分区或项目顺序',disabled:true,reason:this.snapshot?.capabilities.reorderSection.reason},
    ]);
    this.progress=make('span','sidebar-progress','正在更新…');this.progress.setAttribute('role','status');this.progress.hidden=true;this.toolbar.append(archive,this.progress,more);options.node.before(this.toolbar);
    document.addEventListener('pointerdown',e=>{if(this.menu&&!this.menu.contains(e.target)&&!this.menuAnchor?.contains(e.target))this.closeMenu(false);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.menu){e.preventDefault();e.stopImmediatePropagation();this.closeMenu();}},true);
    window.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('resize',()=>this.positionMenu());
    window.visualViewport?.addEventListener('scroll',()=>this.positionMenu());
  }
  key(){return 'rcm.sidebar.collapsed.'+this.o.host+'.'+(this.scope||'unknown');}
  save(){try{localStorage.setItem(this.key(),JSON.stringify([...this.collapsed]));}catch{}}
  expandProject(id){this.collapsed.delete('project:'+id);this.save();}
  entry(label,action,run,extra={}){const c=this.snapshot?.capabilities[action];return {label,run,disabled:!this.o.connected()||this.pending||!c?.supported,reason:!this.o.connected()?'连接目标机器后可操作。':c?.reason,...extra};}
  render(snapshot,view={}){
    this.view=view;if(!snapshot)return;if(this.drag){this.snapshot=snapshot;return;}
    this.snapshot=snapshot;
    if(this.scope!==snapshot.accountScope){this.scope=snapshot.accountScope;try{this.collapsed=new Set(JSON.parse(localStorage.getItem(this.key())||'[]'));}catch{this.collapsed=new Set();}this.closeMenu(false);this.undoNode?.remove();}
    this.archiveButton.textContent=snapshot.archived?'返回会话':'已归档';this.archiveButton.setAttribute('aria-pressed',String(snapshot.archived));
    const focused=document.activeElement?.dataset?.focusKey,scroll=this.node.parentElement.scrollTop;
    this.node.replaceChildren();
    for(const group of sidebarGroups(snapshot)){
      const items=group.items.filter(i=>!view.search||i.kind==='thread'||i.children.length);
      if(view.search&&!items.length)continue;
      const wrap=make('section','sidebar-group'),header=make('div','sidebar-group-heading');
      const disclosure=make('button','sidebar-section-button');disclosure.type='button';disclosure.dataset.focusKey='section:'+group.id;
      const expanded=!!view.search||!this.collapsed.has('section:'+group.id);disclosure.setAttribute('aria-expanded',String(expanded));disclosure.append(this.o.icon('chevron'),make('span','',group.name));
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
  setBusy(pending){this.node.setAttribute('aria-busy',String(pending));this.progress.hidden=!pending;this.archiveButton.disabled=pending;this.toolbar.querySelector('.icon-button').disabled=pending;for(const b of this.node.querySelectorAll('.sidebar-item-menu'))b.disabled=pending;}
  toggle(key){if(this.collapsed.has(key))this.collapsed.delete(key);else this.collapsed.add(key);this.save();this.render(this.snapshot,this.view);}
  disclosureKeys(button,key){button.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const collapse=e.key==='ArrowLeft';if(collapse)this.collapsed.add(key);else this.collapsed.delete(key);this.save();this.render(this.snapshot,this.view);}});}
  renderProject(parent,item){
    const p=item.value,group=make('div','project-group'),header=make('div','project-heading');
    const button=make('button','project-button');button.type='button';button.dataset.projectId=p.id;button.dataset.focusKey='project:'+p.id;button.title=p.roots.join('\n');
    const expanded=!!this.view.search||!this.collapsed.has('project:'+p.id);button.setAttribute('aria-expanded',String(expanded));button.append(this.o.icon('chevron','project-chevron'),this.o.icon('folder'),make('span','project-name',p.name));
    const children=make('div','project-threads');children.id='sidebar-project-'+p.id;children.hidden=!expanded;button.setAttribute('aria-controls',children.id);button.onclick=()=>this.toggle('project:'+p.id);this.disclosureKeys(button,'project:'+p.id);header.append(button);
    this.addMenu(header,button,()=>[
      {label:'在项目中新建会话',disabled:!this.o.connected(),run:()=>this.o.newThread(p.roots[0])},
      {label:'移动到分区 / 置顶项目',disabled:true,reason:this.snapshot.capabilities.moveProjectSection.reason},
      {label:'调整项目顺序',disabled:true,reason:this.snapshot.capabilities.reorderProject.reason},
    ]);
    for(const child of item.children)this.renderThread(children,child.value);
    if(!item.children.length)children.append(make('p','project-empty','暂无会话'));
    group.append(header,children);parent.append(group);
  }
  renderThread(parent,t){
    const row=make('div','sidebar-thread'),button=make('button','thread-row'+(this.o.selectedId()===t.id?' selected':''));button.type='button';button.dataset.threadId=t.id;button.dataset.focusKey='thread:'+t.id;button.title=this.o.threadName(t);
    if(this.o.selectedId()===t.id)button.setAttribute('aria-current','true');
    const title=make('div','thread-name');if(t.isUnread){const dot=make('span','thread-unread');dot.setAttribute('aria-label','未读');title.append(dot);}title.append(make('span','',this.o.threadName(t)));
    if(t.status?.type==='active')title.append(make('span','thread-running'));
    const meta=make('div','thread-meta');meta.append(make('span','thread-time',this.o.relativeTime(t.recencyAt||t.updatedAt)));button.append(title,meta);button.onclick=()=>this.o.select(t);
    row.append(button);this.addMenu(row,button,()=>this.threadMenu(t));
    const manual=t.isPinned&&this.snapshot.preferences.pinned==='manual'&&this.snapshot.capabilities.reorderThread.supported;
    if(manual&&!this.snapshot.archived){button.draggable=true;button.ondragstart=e=>{if(this.pending){e.preventDefault();return;}this.drag=t;e.dataTransfer.setData('text/plain',t.id);};button.ondragend=()=>{this.drag=null;this.render(this.snapshot,this.view);};button.ondragover=e=>{if(this.drag&&this.drag.id!==t.id&&this.drag.sectionId===t.sectionId)e.preventDefault();};button.ondrop=e=>{e.preventDefault();if(this.drag?.sectionId===t.sectionId&&this.drag.id!==t.id)this.run('reorderThread',this.drag,{beforeThreadId:t.id});this.drag=null;};}
    parent.append(row);
  }
  addMenu(container,anchor,entries){
    const more=make('button','sidebar-item-menu','⋯');more.type='button';more.setAttribute('aria-label','更多操作：'+(anchor.title||anchor.textContent));more.dataset.focusKey='menu:'+anchor.dataset.focusKey;
    const open=e=>{e.preventDefault();this.openMenu(more,entries());};more.onclick=open;anchor.oncontextmenu=open;
    anchor.onkeydown=e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)open(e);};container.append(more);
  }
  threadMenu(t){
    if(t.archived)return [this.entry('恢复会话','restore',()=>this.run('restore',t))];
    const entries=[this.entry('重命名','rename',()=>this.edit('rename',t,'重命名会话',t.name)),this.entry(t.isPinned?'取消置顶':'置顶','pin',()=>this.run('pin',t,{pinned:!t.isPinned})),this.entry('移动到项目','moveProject',()=>this.choose('moveProject',t)),this.entry('移动到分区','moveSection',()=>this.choose('moveSection',t)),this.entry(t.isUnread?'标记已读':'标记未读','read',()=>this.run('read',t,{read:!!t.isUnread}),{disabled:!this.o.connected()||!t.readRevision||!this.snapshot.capabilities.read.supported,reason:this.snapshot.capabilities.read.reason})];
    if(t.isPinned&&this.snapshot.preferences.pinned==='manual'){
      const peers=this.snapshot.data.filter(x=>x.sectionId===t.sectionId).sort((a,b)=>(a.sectionPosition??Infinity)-(b.sectionPosition??Infinity)||a.id.localeCompare(b.id));const index=peers.findIndex(x=>x.id===t.id);
      if(index>0)entries.push(this.entry('上移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index-1].id})));
      if(index<peers.length-1)entries.push(this.entry('下移','reorderThread',()=>this.run('reorderThread',t,{beforeThreadId:peers[index+2]?.id??null})));
    }
    entries.push(this.entry('归档会话','archive',()=>this.run('archive',t),t.status?.type==='active'?{disabled:true,reason:'会话正在运行，请结束后再归档。'}:{}));return entries;
  }
  sectionMenu(s){return [this.entry('重命名分区','renameSection',()=>this.edit('renameSection',s,'重命名分区',s.name)),this.entry('删除分区','deleteSection',()=>this.confirmDelete(s)),{label:'调整分区顺序',disabled:true,reason:this.snapshot.capabilities.reorderSection.reason}];}
  openMenu(anchor,entries){
    this.closeMenu(false);this.menuAnchor=anchor;const menu=make('div','sidebar-menu');menu.setAttribute('role','menu');
    for(const [index,item] of entries.entries()){const button=make('button','',item.label);button.type='button';button.setAttribute('role','menuitem');button.disabled=!!item.disabled;if(item.reason&&item.disabled){button.title=item.reason;button.setAttribute('aria-description',item.reason);}button.onclick=()=>{this.closeMenu(false);item.run?.();};menu.append(button);if(item.reason&&item.disabled){const reason=make('span','control-reason',item.reason);reason.id='sidebar-reason-'+index;button.setAttribute('aria-describedby',reason.id);menu.append(reason);}}
    if(entries.some(e=>e.disabled&&e.reason?.includes('桌面版')))menu.append(make('p','menu-note','部分组织设置需在桌面版修改，同步后会更新。'));
    document.body.append(menu);this.menu=menu;this.positionMenu();
    const focus=()=>[...menu.querySelectorAll('button:not(:disabled)')];focus()[0]?.focus();menu.onkeydown=e=>{const buttons=focus(),index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End','Tab'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowUp'||e.shiftKey?-1:1)+buttons.length)%buttons.length;buttons[n]?.focus();}};
  }
  closeMenu(restore=true){if(!this.menu)return;this.menu.remove();this.menu=null;if(restore)this.menuAnchor?.focus();}
  positionMenu(){
    if(!this.menu)return;
    const rect=this.menuAnchor.getBoundingClientRect(),v=window.visualViewport,top=v?.offsetTop||0,height=v?.height||innerHeight;
    this.menu.style.maxHeight=Math.max(44,height-16)+'px';
    this.menu.style.left=Math.max(8,Math.min(rect.right-this.menu.offsetWidth,innerWidth-this.menu.offsetWidth-8))+'px';
    this.menu.style.top=Math.max(top+8,Math.min(rect.bottom,top+height-this.menu.offsetHeight-8))+'px';
  }
  modal(title){
    const dialog=make('dialog','sidebar-dialog'),form=make('form');form.onsubmit=e=>e.preventDefault();form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||e.keyCode===229))e.preventDefault();});const h=make('h2','',title);h.id='sidebar-dialog-title';dialog.setAttribute('aria-labelledby',h.id);form.append(h);dialog.append(form);document.body.append(dialog);
    const actions=make('div','sidebar-dialog-actions'),cancel=make('button','secondary-button','取消'),submit=make('button','primary-button','保存');cancel.type='button';submit.type='submit';actions.append(cancel,submit);const error=make('p','sidebar-dialog-error');error.setAttribute('role','alert');
    const close=()=>{dialog.close();dialog.remove();this.dialog=null;this.focusAnchor();};cancel.onclick=close;dialog.oncancel=e=>{if(this.pending)e.preventDefault();};dialog.addEventListener('close',()=>{if(dialog.isConnected){dialog.remove();this.dialog=null;this.focusAnchor();}});this.dialog=dialog;dialog.dataset.accountScope=this.snapshot.accountScope||'';
    dialog.addEventListener('click',e=>{if(e.target!==dialog||this.pending)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();});
    return {dialog,form,actions,submit,cancel,error,close,finish:()=>{form.append(error,actions);dialog.showModal();form.querySelector('input,select,button')?.focus();}};
  }
  edit(action,target,title,value=''){
    const m=this.modal(title),label=make('label','',title),input=make('input');input.value=value||'';input.required=true;input.maxLength=200;label.append(input);m.form.append(label);
    m.form.onsubmit=async e=>{e.preventDefault();if(this.pending)return;const label=m.submit.textContent;m.submit.textContent='正在处理…';m.submit.disabled=m.cancel.disabled=true;try{await this.run(action,target,{name:input.value},true);m.close();}catch(error){m.error.textContent=error.message;}finally{m.submit.textContent=label;m.submit.disabled=m.cancel.disabled=false;if(m.dialog.isConnected)m.form.querySelector('input,select,button')?.focus();}};m.finish();input.select();
  }
  choose(action,target){
    const project=action==='moveProject',m=this.modal(project?'移动到项目':'移动到分区'),label=make('label','',project?'项目':'分区'),select=make('select');select.append(new Option(project?'不关联项目':'移出分区',''));
    for(const item of project?this.snapshot.projects:this.snapshot.sections)select.append(new Option(item.name,item.id));select.value=(project?target.projectId:target.sectionId)||'';label.append(select);m.form.append(label);
    m.form.onsubmit=async e=>{e.preventDefault();if(this.pending)return;const label=m.submit.textContent;m.submit.textContent='正在处理…';m.submit.disabled=m.cancel.disabled=true;try{await this.run(action,target,{[project?'projectId':'sectionId']:select.value||null},true);m.close();}catch(error){m.error.textContent=error.message;}finally{m.submit.textContent=label;m.submit.disabled=m.cancel.disabled=false;if(m.dialog.isConnected)m.form.querySelector('input,select,button')?.focus();}};m.finish();
  }
  confirmDelete(section){const m=this.modal('删除分区');m.form.append(make('p','','删除“'+section.name+'”分区，其中的会话和项目会保留。'));m.submit.textContent='删除分区';m.form.onsubmit=async e=>{e.preventDefault();if(this.pending)return;const label=m.submit.textContent;m.submit.textContent='正在处理…';m.submit.disabled=m.cancel.disabled=true;try{await this.run('deleteSection',section,{},true);m.close();}catch(error){m.error.textContent=error.message;}finally{m.submit.textContent=label;m.submit.disabled=m.cancel.disabled=false;if(m.dialog.isConnected)m.form.querySelector('input,select,button')?.focus();}};m.finish();}
  focusAnchor(){const key=this.menuAnchor?.dataset.focusKey;[...this.node.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===key)?.focus({preventScroll:true});if(!document.activeElement||document.activeElement===document.body)this.node.querySelector('button')?.focus({preventScroll:true});}
  async run(action,target,extra={},propagate=false){
    if(this.pending){if(propagate)throw Error('正在更新，请等待操作完成。');return;}if(this.dialog&&this.dialog.dataset.accountScope!==(this.snapshot.accountScope||''))throw Error('目标账号已变化，请取消后刷新；输入内容已保留。');this.pending=true;this.setBusy(true);
    try{await this.o.api('/api/sidebar/actions',{method:'POST',body:{action,id:target?.id,expectedRevision:target?.revision,accountScope:this.snapshot.accountScope,...extra}});
      await this.o.changed(action,target);this.o.toast(action==='archive'?'会话已归档':action==='restore'?'会话已恢复':'已更新');
      if(action==='archive')this.undo(target.id);if(action==='restore'&&this.undoId===target.id)this.undoNode?.remove();
    }catch(error){await this.o.refresh().catch(()=>{});if(propagate)throw error;this.o.toast(error.message,true);}
    finally{this.pending=false;this.setBusy(false);if(!this.dialog)this.focusAnchor();}
  }
  undo(id){
    const scope=this.snapshot.accountScope;this.undoId=id;
    this.undoNode?.remove();const node=make('div','sidebar-undo');node.setAttribute('role','status');node.append(make('span','','会话已归档'));const button=make('button','','撤销');button.type='button';button.onclick=async()=>{button.disabled=true;try{const s=await this.o.api('/api/sidebar?archived=true&search=');if(s.accountScope!==scope)throw Error('目标账号已变化，请在已归档列表核对。');let t=s.data.find(t=>t.id===id),cursor=s.nextCursor;while(!t&&cursor){const p=await this.o.api('/api/sidebar?archived=true&cursor='+encodeURIComponent(cursor));t=p.data.find(t=>t.id===id);cursor=p.nextCursor;}if(!t)throw Error('归档状态已变化，请刷新列表。');await this.o.api('/api/sidebar/actions',{method:'POST',body:{action:'restore',id,expectedRevision:t.revision,accountScope:s.accountScope}});await this.o.changed('restore',t);node.remove();this.focusAnchor();}catch(e){this.o.toast(e.message,true);button.disabled=false;}};node.append(button);this.toolbar.after(node);this.undoNode=node;
  }
}
