// Serialization matches the desktop response-annotation prompt wrapper.
export function annotatedText(text,annotations=[],selections=[]){
 let context='';
 if(annotations.length)context+='\n# Response annotations:\nEach item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position (for example, `:codex-annotation{index="1"}`). Do not use unstructured annotation labels.\n<response-annotations>\n'+JSON.stringify(annotations.map(({text,annotation,source})=>({text,annotation,source})))+'\n</response-annotations>\n';
 if(selections.length)context+='\n# Selected text:\n'+selections.map((s,i)=>'\n## Selection '+(i+1)+'\n'+s.text+'\n').join('');
 return context?context+'\n## My request:\n'+text+'\n':text;
}
export function installResponseAnnotations({context,host,onSideChat,sideSelections=()=>[],changed,notify}){
 const input=document.getElementById('message-input'),messages=document.getElementById('messages');
 const key='rcm.annotations.'+host;let drafts={};try{drafts=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
 const current=()=>Array.isArray(drafts[context().id])?drafts[context().id]:[];
 const save=()=>{try{sessionStorage.setItem(key,JSON.stringify(drafts));}catch{notify('注释暂时仅保留在当前页面，刷新可能丢失。',true);}};
 const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;return b;};
 const menu=document.createElement('div');menu.className='selection-actions';menu.hidden=true;menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','选中文本操作');document.body.append(menu);
 const editor=document.createElement('div');editor.className='annotation-editor';editor.hidden=true;editor.setAttribute('role','dialog');editor.setAttribute('aria-label','添加注释');
 const heading=document.createElement('strong');heading.textContent='添加到对话';const excerpt=document.createElement('blockquote');excerpt.className='annotation-excerpt';
 const comment=document.createElement('textarea');comment.placeholder='添加可选评论…';comment.setAttribute('aria-label','注释评论');comment.rows=2;
 const done=button('添加',()=>commit());done.className='annotation-submit';const actions=document.createElement('div');actions.className='annotation-editor-actions';actions.append(button('取消',()=>dismiss()),done);editor.append(heading,excerpt,comment,actions);document.body.append(editor);
 const chip=button('',()=>{details.hidden=!details.hidden;chip.setAttribute('aria-expanded',String(!details.hidden));});chip.className='annotation-chip';chip.hidden=true;chip.setAttribute('aria-expanded','false');
 const details=document.createElement('div');details.className='annotation-drafts';details.hidden=true;document.getElementById('message-form').prepend(chip,details);
 let selection=null,editing=null,version=null,lastDraftKey=null,ranges=new Map(),dismissedSelection='';const comments=new Map();
 const markers=document.createElement('div');markers.className='annotation-markers';document.body.append(markers);
 let markerFrame=null;
 function paint(){
  markerFrame=null;markers.replaceChildren();const valid=[];
  const entries=[...current(),...sideSelections().map((item,index)=>({...item,id:'side:'+index,side:true,sideIndex:index}))];
  entries.forEach((item,index)=>{
   let r=item.range||ranges.get(item.id);
   if(!r?.startContainer.isConnected){
    const node=messages.querySelector('[data-message-id="'+CSS.escape(item.source?.messageId||'')+'"]');
    if(!node)return;const start=item.source?.startOffset??node.textContent.indexOf(item.text);if(start<0||node.textContent.slice(start,start+item.text.length)!==item.text)return;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let offset=0,n,begin=false;r=document.createRange();
    while((n=walker.nextNode())){const end=offset+n.length;if(!begin&&start<end){r.setStart(n,start-offset);begin=true;}if(begin&&start+item.text.length<=end){r.setEnd(n,start+item.text.length-offset);break;}offset=end;}
    if(!begin||!n)return;ranges.set(item.id,r);
   }
   valid.push(r);const rect=r.getBoundingClientRect(),bounds=document.getElementById('messages-scroller').getBoundingClientRect();if(rect.bottom<bounds.top||rect.top>bounds.bottom||rect.width===0)return;
   const number=item.side?item.sideIndex+1:index+1;const marker=button(String(number),()=>{if(item.side){document.querySelector('.side-chat-panel details').open=true;document.querySelector('.side-chat-panel .composer textarea').focus();return;}details.hidden=false;chip.setAttribute('aria-expanded','true');details.querySelectorAll('textarea')[index]?.focus();});marker.className='annotation-marker';marker.setAttribute('aria-label',(item.side?'已选文本片段 ':'注释 ')+number);marker.style.left=Math.min(innerWidth-44,Math.max(0,rect.right-20))+'px';marker.style.top=Math.max(bounds.top,rect.top-20)+'px';markers.append(marker);
  });
  if(globalThis.CSS?.highlights&&globalThis.Highlight)CSS.highlights.set('rcm-annotations',new Highlight(...valid));
 }
 const schedulePaint=()=>{if(!markerFrame)markerFrame=requestAnimationFrame(paint);};
 document.getElementById('messages-scroller').addEventListener('scroll',()=>{menu.hidden=true;schedulePaint();requestAnimationFrame(select);},{passive:true});
 window.addEventListener('resize',schedulePaint);
 new MutationObserver(schedulePaint).observe(messages,{childList:true,subtree:true});
 const position=(node,rect)=>{const v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;node.style.maxHeight=Math.max(100,height-16)+'px';node.style.left=Math.max(left+8,Math.min(rect.left,left+width-node.offsetWidth-8))+'px';const above=rect.top-node.offsetHeight-8;node.style.top=Math.max(top+8,Math.min(above>=top+8?above:rect.bottom+8,top+height-node.offsetHeight-8))+'px';};
 const selectionKey=s=>s?JSON.stringify([s.context,s.source,s.text]):'';
 function dismiss(){if(editing){comments.set(selectionKey(editing),comment.value);if(comments.size>50)comments.delete(comments.keys().next().value);}dismissedSelection=getSelection()?.toString()||'';menu.hidden=true;editor.hidden=true;editing=null;selection=null;}
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!editor.contains(e.target)){dismiss();if(!details.contains(e.target)&&!chip.contains(e.target)&&!e.target.closest('.annotation-marker')){details.hidden=true;chip.setAttribute('aria-expanded','false');}}});
 const reposition=()=>{if(editing&&!editor.hidden)position(editor,editing.range.getBoundingClientRect());};window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);window.addEventListener('resize',reposition);
 function commit(){if(!editing||editing.context!==context().id)return dismiss();const list=current();if(list.length>=20){notify('每条消息最多添加 20 条注释。',true);return;}drafts[context().id]=[...list,{id:crypto.randomUUID(),text:editing.text,annotation:comment.value,source:editing.source}];ranges.set(drafts[context().id].at(-1).id,editing.range);save();dismiss();render();changed();input.focus();}
 function select(){
  if(!editor.hidden)return;if(document.activeElement?.closest('.side-chat-panel')){menu.hidden=true;return;}
  const s=getSelection();if(!s?.rangeCount||s.isCollapsed){menu.hidden=true;return;}
  const r=s.getRangeAt(0),element=n=>n.nodeType===1?n:n.parentElement;
  const first=element(r.startContainer)?.closest('.message.agent'),last=element(r.endContainer)?.closest('.message.agent');
  if(!first||first!==last||!messages.contains(first)){menu.hidden=true;return;}
  const text=s.toString();if(text===dismissedSelection||!text.trim()||text.length>20000){menu.hidden=true;return;}
  const prefix=r.cloneRange();prefix.selectNodeContents(first);prefix.setEnd(r.startContainer,r.startOffset);
  selection={context:context().id,text,range:r.cloneRange(),source:{startOffset:prefix.toString().length,threadId:context().id,messageId:first.dataset.messageId,turnId:first.closest('[data-turn-id]')?.dataset.turnId}};
  menu.hidden=false;position(menu,r.getBoundingClientRect());
 }
 menu.append(button('添加到对话',()=>{if(!selection)return;editing=selection;comment.value=comments.get(selectionKey(editing))||'';excerpt.textContent=editing.text;menu.hidden=true;editor.hidden=false;position(editor,editing.range.getBoundingClientRect());comment.focus();}),button('在侧边聊天中提问',()=>{if(!selection)return;const chosen=selection;dismiss();onSideChat(chosen);}));
 menu.addEventListener('pointerdown',e=>e.preventDefault());
 messages.addEventListener('pointerup',()=>{dismissedSelection='';select();});
 document.addEventListener('selectionchange',()=>{if(document.activeElement===comment||menu.contains(document.activeElement))return;select();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&(!menu.hidden||!editor.hidden)){dismiss();input.focus();}});
 comment.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing){e.preventDefault();commit();}});
 messages.addEventListener('scroll',()=>{menu.hidden=true;},{passive:true});
 function render(){
  schedulePaint();
  if(version!==context().id){version=context().id;dismiss();details.hidden=true;ranges.clear();}
  const items=current();const draftKey=JSON.stringify([context().id,items]);if(draftKey===lastDraftKey)return;lastDraftKey=draftKey;chip.hidden=!items.length;chip.textContent=items.length+' 条注释';chip.setAttribute('aria-expanded',String(!details.hidden));
  details.replaceChildren();
  for(const item of items){const row=document.createElement('div');row.className='annotation-draft';const quote=document.createElement('blockquote');quote.textContent=item.text;const field=document.createElement('textarea');field.value=item.annotation;field.setAttribute('aria-label','编辑注释评论');field.oninput=()=>{item.annotation=field.value;save();lastDraftKey=JSON.stringify([context().id,current()]);};row.append(quote,field,button('移除注释',()=>{drafts[context().id]=current().filter(i=>i.id!==item.id);ranges.delete(item.id);save();render();changed();}));details.append(row);}
  // CSS Highlights preserve the original message DOM and selection offsets.
  if(globalThis.CSS?.highlights&&globalThis.Highlight){const valid=items.map(i=>ranges.get(i.id)).filter(r=>r?.startContainer.isConnected);CSS.highlights.set('rcm-annotations',new Highlight(...valid));}
 }
 return {render,refreshMarks:schedulePaint,has:()=>current().length>0,capture:()=>({id:context().id,items:current().map(i=>({...i}))}),acknowledge(sent){const sentItems=new Map(sent.items.map(i=>[i.id,i]));drafts[sent.id]=(drafts[sent.id]||[]).filter(i=>!sentItems.has(i.id)||sentItems.get(i.id).annotation!==i.annotation||sentItems.get(i.id).text!==i.text);save();render();},moveDraft(from,to){drafts[to]=drafts[from]||[];delete drafts[from];save();}};
}
