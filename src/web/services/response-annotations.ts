import {compactLayout} from '../../../public/mobile-ui.js';
import type {SideFragment} from './side-chat';
interface Source {messageId?:string;threadId?:string|null;turnId?:string;startOffset?:number;[field:string]:unknown}
export interface Annotation {id:string;text:string;annotation:string;source?:Source;range?:Range}
interface Selection {context:string|null;text:string;range:Range;source:Source}
interface Capture {id:string|null;items:Annotation[]}
export interface AnnotationViewState {menuHidden:boolean;editorHidden:boolean;chipHidden:boolean;chipText:string;detailsHidden:boolean;expanded:boolean;excerpt:string}
export interface Marker {label:string;text:string;left:number;top:number;activate:()=>void}
export interface DraftRow {item:Annotation;edit:(value:string)=>void;remove:()=>void}
export interface AnnotationActions {toggle:()=>void;add:()=>void;side:()=>void;commit:()=>void;dismiss:()=>void;cancel:()=>void}
export interface AnnotationView {menu:HTMLDivElement;editor:HTMLDivElement;comment:HTMLTextAreaElement;chip:HTMLButtonElement;details:HTMLDivElement;patch:(patch:Partial<AnnotationViewState>)=>void;drafts:(rows:DraftRow[])=>void;markers:(rows:Marker[])=>void}
interface Options {host:string;context:()=>{id:string|null};onSideChat:(selection:Selection)=>void;sideSelections?:()=>SideFragment[];changed:()=>void;notify:(message:string,error:boolean)=>unknown}
let viewInstaller:((actions:AnnotationActions)=>AnnotationView)|undefined;
export function configureAnnotationView(value:NonNullable<typeof viewInstaller>){viewInstaller=value;}
// Serialization matches the desktop response-annotation prompt wrapper.
export function annotatedText(text:string,annotations:Array<Pick<Annotation,'text'|'annotation'|'source'>>=[],selections:Array<{text:string}>=[]){
 let context='';
 if(annotations.length)context+='\n# Response annotations:\nEach item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position (for example, `:codex-annotation{index="1"}`). Do not use unstructured annotation labels.\n<response-annotations>\n'+JSON.stringify(annotations.map(({text,annotation,source})=>({text,annotation,source})))+'\n</response-annotations>\n';
 if(selections.length)context+='\n# Selected text:\n'+selections.map((s,i)=>'\n## Selection '+(i+1)+'\n'+s.text+'\n').join('');
 return context?context+'\n## My request:\n'+text+'\n':text;
}
export function installResponseAnnotations({context,host,onSideChat,sideSelections=()=>[],changed,notify}:Options){
 const input=document.getElementById('message-input') as HTMLTextAreaElement,messages=document.getElementById('messages')!;
 const key='rcm.annotations.'+host;let drafts:Record<string,Annotation[]>={};try{drafts=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
 const current=()=>Array.isArray(drafts[context().id as string])?drafts[context().id as string]:[];
 const save=()=>{try{sessionStorage.setItem(key,JSON.stringify(drafts));}catch{notify('注释暂时仅保留在当前页面，刷新可能丢失。',true);}};
 let selection:Selection|null=null,editing:Selection|null=null,version:string|null=null,lastDraftKey:string|null=null,ranges=new Map<string,Range>(),dismissedSelection='';const comments=new Map<string,string>();
 if(!viewInstaller)throw Error('注释视图未安装。');
 const view=viewInstaller({toggle:()=>{const show=Boolean(details.hidden);view.patch({detailsHidden:!show,expanded:show});},commit:()=>commit(),dismiss:()=>dismiss(),cancel:()=>{dismiss();getSelection()?.removeAllRanges();},
  add:()=>{if(!selection)return;editing=selection;comment.value=comments.get(selectionKey(editing))||'';view.patch({excerpt:editing.text,menuHidden:true,editorHidden:false});position(editor,editing.range.getBoundingClientRect());comment.focus();},
  side:()=>{if(!selection)return;const chosen=selection;dismiss();onSideChat(chosen);}});
 const {menu,editor,comment,chip,details}=view;
 let markerFrame:number|null=null;
 function paint(){
  markerFrame=null;const markerRows:Marker[]=[],valid:Range[]=[];
  const entries:Array<Partial<Annotation>&{id:string;text:string;side?:boolean;sideIndex?:number}>=[...current(),...sideSelections().map((item,index)=>({...item,id:'side:'+index,side:true,sideIndex:index})) as Array<Partial<Annotation>&{id:string;text:string;side:boolean;sideIndex:number}>];
  entries.forEach((item,index)=>{
   let r=item.range||ranges.get(item.id);
   if(!r?.startContainer.isConnected){
    const node=messages.querySelector<HTMLElement>('[data-message-id="'+CSS.escape(item.source?.messageId||'')+'"]');
    if(!node)return;const start=item.source?.startOffset??node.textContent!.indexOf(item.text);if(start<0||node.textContent!.slice(start,start+item.text.length)!==item.text)return;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let offset=0,n:Node|null,begin=false;r=document.createRange();
    while((n=walker.nextNode())){const end=offset+(n as Text).length;if(!begin&&start<end){r.setStart(n,start-offset);begin=true;}if(begin&&start+item.text.length<=end){r.setEnd(n,start+item.text.length-offset);break;}offset=end;}
    if(!begin||!n)return;ranges.set(item.id,r);
   }
   valid.push(r);const rect=r.getBoundingClientRect(),bounds=document.getElementById('messages-scroller')!.getBoundingClientRect();if(rect.bottom<bounds.top||rect.top>bounds.bottom||rect.width===0)return;
   const number=item.side?item.sideIndex!+1:index+1;
   markerRows.push({text:String(number),label:(item.side?'已选文本片段 ':'注释 ')+number,left:Math.min(innerWidth-44,Math.max(0,rect.right-20)),top:Math.max(bounds.top,rect.top-20),activate:()=>{if(item.side){document.querySelector<HTMLDetailsElement>('.side-chat-fragments')!.open=true;document.querySelector<HTMLTextAreaElement>('.side-chat-panel .composer textarea')!.focus();return;}view.patch({detailsHidden:false,expanded:true});details.querySelectorAll('textarea')[index]?.focus();}});
  });
  view.markers(markerRows);
  if(globalThis.CSS?.highlights&&globalThis.Highlight)CSS.highlights.set('rcm-annotations',new Highlight(...valid));
 }
 const schedulePaint=()=>{if(!markerFrame)markerFrame=requestAnimationFrame(paint);};
 document.getElementById('messages-scroller')!.addEventListener('scroll',()=>{view.patch({menuHidden:true});schedulePaint();requestAnimationFrame(select);},{passive:true});
 window.addEventListener('resize',schedulePaint);
 new MutationObserver(schedulePaint).observe(messages,{childList:true,subtree:true});
 const position=(node:HTMLElement,rect:DOMRect)=>{const v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;node.style.maxHeight=Math.max(100,height-16)+'px';node.style.left=Math.max(left+8,Math.min(rect.left,left+width-node.offsetWidth-8))+'px';const above=rect.top-node.offsetHeight-8;node.style.top=Math.max(top+8,Math.min(above>=top+8?above:rect.bottom+8,top+height-node.offsetHeight-8))+'px';};
 const selectionKey=(s:Selection|null)=>s?JSON.stringify([s.context,s.source,s.text]):'';
 function dismiss(){if(editing){comments.set(selectionKey(editing),comment.value);if(comments.size>50)comments.delete(comments.keys().next().value!);}dismissedSelection=getSelection()?.toString()||'';view.patch({menuHidden:true});view.patch({editorHidden:true});editing=null;selection=null;}
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node)&&!editor.contains(e.target as Node)){dismiss();if(!details.contains(e.target as Node)&&!chip.contains(e.target as Node)&&!(e.target as Element).closest('.annotation-marker')){view.patch({detailsHidden:true,expanded:false});}}});
 const reposition=()=>{if(editing&&!editor.hidden)position(editor,editing.range.getBoundingClientRect());};window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);window.addEventListener('resize',()=>{reposition();select();});
 function commit(){if(!editing||editing.context!==context().id)return dismiss();const list=current();if(list.length>=20){notify('每条消息最多添加 20 条注释。',true);return;}drafts[context().id as string]=[...list,{id:crypto.randomUUID(),text:editing.text,annotation:comment.value,source:editing.source}];ranges.set(drafts[context().id as string].at(-1)!.id,editing.range);save();dismiss();render();changed();input.focus();}
 function select(){
  if(!editor.hidden)return;if(document.activeElement?.closest('.side-chat-panel')){view.patch({menuHidden:true});return;}
  const s=getSelection();if(!s?.rangeCount||s.isCollapsed){selection=null;dismissedSelection='';view.patch({menuHidden:true});return;}
  const r=s.getRangeAt(0),element=(n:Node)=>n.nodeType===1?n as Element:n.parentElement;
  const first=element(r.startContainer)?.closest<HTMLElement>('.message.agent'),last=element(r.endContainer)?.closest<HTMLElement>('.message.agent');
  if(!first||first!==last||!messages.contains(first)){view.patch({menuHidden:true});return;}
  const text=s.toString();if(text===dismissedSelection||!text.trim()||text.length>20000){view.patch({menuHidden:true});return;}
  const prefix=r.cloneRange();prefix.selectNodeContents(first);prefix.setEnd(r.startContainer,r.startOffset);
  selection={context:context().id,text,range:r.cloneRange(),source:{startOffset:prefix.toString().length,threadId:context().id,messageId:first.dataset.messageId,turnId:first.closest<HTMLElement>('[data-turn-id]')?.dataset.turnId}};
  view.patch({menuHidden:false});if(!compactLayout())position(menu,r.getBoundingClientRect());
 }
 menu.addEventListener('pointerdown',e=>e.preventDefault());
 messages.addEventListener('pointerup',()=>{dismissedSelection='';select();});
 document.addEventListener('selectionchange',()=>{if(document.activeElement===comment||menu.contains(document.activeElement))return;select();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&(!menu.hidden||!editor.hidden)){dismiss();input.focus();}});
 comment.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing){e.preventDefault();commit();}});
 messages.addEventListener('scroll',()=>{view.patch({menuHidden:true});},{passive:true});
 function render(){
  schedulePaint();
  if(version!==context().id){version=context().id;dismiss();view.patch({detailsHidden:true});ranges.clear();}
  const items=current();const draftKey=JSON.stringify([context().id,items]);if(draftKey===lastDraftKey)return;lastDraftKey=draftKey;view.patch({chipHidden:!items.length,chipText:items.length+' 条注释',expanded:!details.hidden});
  view.drafts(items.map(item=>({item,edit:(value:string)=>{item.annotation=value;save();lastDraftKey=JSON.stringify([context().id,current()]);},remove:()=>{drafts[context().id as string]=current().filter(i=>i.id!==item.id);ranges.delete(item.id);save();render();changed();}})));
  // CSS Highlights preserve the original message DOM and selection offsets.
  if(globalThis.CSS?.highlights&&globalThis.Highlight){const valid=items.map(i=>ranges.get(i.id)).filter((r):r is Range=>Boolean(r?.startContainer.isConnected));CSS.highlights.set('rcm-annotations',new Highlight(...valid));}
 }
 return {render,refreshMarks:schedulePaint,has:()=>current().length>0,capture:()=>({id:context().id,items:current().map(i=>({...i}))}),acknowledge(sent:Capture){const sentItems=new Map(sent.items.map(i=>[i.id,i]));drafts[sent.id as string]=(drafts[sent.id as string]||[]).filter(i=>!sentItems.has(i.id)||sentItems.get(i.id)!.annotation!==i.annotation||sentItems.get(i.id)!.text!==i.text);save();render();},moveDraft(from:string,to:string){drafts[to]=drafts[from]||[];delete drafts[from];save();}};
}
