import {compactLayout} from './mobile-ui.ts';
import {navigationIndex,turnPreview,loadAllEarlier,loadTurnUntil,turnCountLabel,type NavigationTurn} from './turn-navigation.ts';
export type NavigationRow=ReturnType<typeof turnPreview>;
interface Context {visible:boolean;ready:boolean;turns:NavigationTurn[];hasEarlier:boolean;cursor?:string|null;loading?:boolean;rendering?:boolean;uncertain?:boolean;renderHistory?:()=>void;reveal?:(id:string)=>void}
interface Options {scroller:HTMLElement;content:HTMLElement;entryHost:HTMLElement;context:()=>Context;follow:{following:boolean;pause:(options:{sticky:boolean})=>void;reset:()=>void};loadEarlier:(options:{deferRender:boolean})=>Promise<boolean|undefined>;loadDirectory?:()=>Promise<{data?:NavigationTurn[]}>;onError?:(message:string)=>void}
export interface NavigationPresentation {railHidden:boolean;entryHidden:boolean;previewHidden:boolean;olderHidden:boolean;moreHidden:boolean;olderDisabled:boolean;moreDisabled:boolean;olderTitle:string;moreText:string;countText:string;entryText:string;titleText:string;ticksHidden:boolean;listHidden:boolean;countTitle:string;countLabel:string;busy:string;feedback:string}
export interface NavigationActions {count:()=>void;older:()=>void;more:()=>void;entry:()=>void;close:()=>void;navigate:(id:string|undefined)=>void;show:(row:NavigationRow,button:HTMLButtonElement)=>void;deferHide:()=>void}
export interface NavigationView {rail:HTMLElement;ticks:HTMLDivElement;preview:HTMLDivElement;entry:HTMLButtonElement;dialog:HTMLDialogElement;list:HTMLDivElement;feedback:HTMLParagraphElement;close:HTMLButtonElement;buttons:Map<string|undefined,HTMLButtonElement>;patch:(value:Partial<NavigationPresentation>)=>void;renderTicks:(rows:NavigationRow[])=>void;renderList:(rows:NavigationRow[],current:string|undefined)=>void;renderPreview:(row:NavigationRow)=>void;current:(id:string|undefined)=>void}
let installer:((entryHost:HTMLElement,actions:NavigationActions)=>NavigationView)|undefined;
export function configureTurnNavigationView(value:NonNullable<typeof installer>){installer=value;}
export function installTurnNavigation({scroller,content,entryHost,context,follow,loadEarlier,loadDirectory,onError=()=>{}}:Options) {
  if(!installer)throw Error('轮次视图未安装。');
  const view=installer(entryHost,{count:()=>loading?cancel():void earlier(),older:()=>void earlier(),more:()=>loading?cancel():void earlier(),entry:()=>openDirectory(),close:()=>dialog.close(),navigate:id=>void navigate(id),show:(row,button)=>show(row,button),deferHide:()=>deferHide()});
  const {rail,ticks,preview,entry,dialog,list,feedback,close,buttons}=view;
  let key:string|null|undefined=null,rows:NavigationRow[]=[],signature='',hovered:string|null|undefined=null,hideTimer:ReturnType<typeof setTimeout>|undefined,frame:number|null|undefined,currentId:string|undefined,loading=false,loadVersion=0,loadMessage='',autoStarted=false;
  let owners=new Map<string|undefined,string|undefined>(),directory:NavigationTurn[]|null=null,navigationVersion=0;
  const pendingHistory=(c:Context)=>loadDirectory?directory===null:c.hasEarlier;
  const positions=new Map<string,{id?:string;offset:number;following:boolean}>();let restore:{id?:string;offset:number;following:boolean}|null=null,directoryTarget:HTMLElement|null=null;
  const nodes=()=>[...content.querySelectorAll<HTMLElement>('.message-turn')];
  const locate=(id:string|undefined)=>nodes().find(n=>n.dataset.turnId===id);
  const reading=()=>{const top=scroller.getBoundingClientRect().top;return nodes().find(n=>n.getBoundingClientRect().bottom>top+24);};
  function hide(){clearTimeout(hideTimer);view.patch({previewHidden:true});hovered=null;}
  function deferHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hide,180);}
  function show(row:NavigationRow,button:HTMLButtonElement){
    if(compactLayout())return;clearTimeout(hideTimer);hovered=row.id;view.renderPreview(row);for(const n of preview.querySelectorAll<HTMLElement>('a,button,[tabindex]'))n.tabIndex=-1;view.patch({previewHidden:false});
    const r=button.getBoundingClientRect();preview.style.left=Math.min(r.right+10,innerWidth-preview.offsetWidth-12)+'px';preview.style.top=Math.max(12,Math.min(r.top-18,innerHeight-preview.offsetHeight-12))+'px';
  }
  function jump(id:string|undefined){
    if(!locate(id))context().reveal?.(id!);
    const target=locate(id);if(!target)return;restore=null;hide();if(dialog.open){directoryTarget=target;dialog.close();}follow.pause({sticky:true});
    const top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;
    scroller.scrollTop=Math.max(0,top);target.tabIndex=-1;target.focus({preventScroll:true});schedule();
  }
  function renderList(){
    const top=list.scrollTop,focused=(document.activeElement as HTMLElement|null)?.dataset.turnTarget,bounds=list.getBoundingClientRect();
    const first=[...list.children as HTMLCollectionOf<HTMLElement>].find(n=>n.getBoundingClientRect().bottom>bounds.top),anchor=first?{id:first.dataset.turnTarget,offset:first.getBoundingClientRect().top-bounds.top}:null;view.renderList(rows,currentId);

    list.scrollTop=top;if(anchor){const node=list.querySelector<HTMLElement>('[data-turn-target="'+CSS.escape(anchor.id!)+'"]');if(node)list.scrollTop+=node.getBoundingClientRect().top-list.getBoundingClientRect().top-anchor.offset;}if(focused)list.querySelector<HTMLElement>('[data-turn-target="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
  }
  function report(message:string){loadMessage=message;view.patch({feedback:message});syncLoad();}
  async function earlier({automatic=false}={}){
    if(loading)return;
    if(loadDirectory){
      if(directory!==null)return;
      const version=++loadVersion,started=key,isCurrent=()=>started===key&&version===loadVersion;
      autoStarted=true;loading=true;loadMessage='';view.patch({feedback:''});syncLoad();
      try{const result=await loadDirectory();if(isCurrent()){if(!Array.isArray(result?.data))throw Error('轮次目录无效');directory=result.data;}}
      catch{if(isCurrent())report('轮次目录读取失败，请重试。');}
      finally{if(isCurrent()){loading=false;update();}}
      return;
    }
    if(!context().hasEarlier){context().renderHistory?.();return;}
    const version=++loadVersion,started=key,isCurrent=()=>started===key&&version===loadVersion;
    autoStarted=true;loading=true;if(!automatic)follow.pause({sticky:true});
    loadMessage='';view.patch({feedback:''});
    const progress=()=>update();
    progress();
    try{
      const loaded=await loadAllEarlier({context,loadEarlier:()=>loadEarlier({deferRender:true}),isCurrent,onProgress:progress});
      if(isCurrent())report(loaded?'':'加载未完成，请重试。');
    }catch{if(isCurrent())report('加载失败，请重试。');}
    finally{if(isCurrent()){loading=false;context().renderHistory?.();syncLoad();update();}}
  }
  function syncLoad(){
    const c=context(),pending=pendingHistory(c);if(!pending&&!loading){loadMessage='';view.patch({feedback:''});}
    const label=turnCountLabel({...c,hasEarlier:pendingHistory(c),loading,loadMessage},rows.length);
    view.patch({olderHidden:!pending,moreHidden:!pending,olderDisabled:Boolean(loading||c.loading),moreDisabled:Boolean(!loading&&c.loading),olderTitle:loading?'正在加载全部轮次…':'加载全部轮次',moreText:loading?'取消加载':loadMessage?'继续加载全部轮次':'加载全部轮次',countText:label?(loadMessage?'重试':rows.length+'轮'):'',entryText:label?'轮次 · '+label:'轮次',titleText:label?'对话轮次 · '+label:'对话轮次',ticksHidden:loading||pending,listHidden:loading||pending});
    if(!label){view.patch({railHidden:true,entryHidden:true});hide();}schedule();
    view.patch({countTitle:loading?'正在加载全部轮次，点击取消':loadMessage||(label?label+'，显示全部轮次':'显示全部轮次'),countLabel:loading?'取消加载全部轮次':loadMessage?'重试加载全部轮次':label?label+'，显示全部轮次':'显示全部轮次',busy:String(loading)});
  }
  function cancel(){loadVersion++;loading=false;context().renderHistory?.();report('已取消继续加载。');}
  async function navigate(id:string|undefined){
    if(!loadDirectory){jump(id);void earlier();return;}
    const version=++navigationVersion,started=key,isCurrent=()=>version===navigationVersion&&started===key;
    follow.pause({sticky:true});hide();view.patch({busy:'true'});
    try{
      const found=await loadTurnUntil(id,{context,loadEarlier,isCurrent});
      if(!isCurrent())return;
      context().renderHistory?.();
      if(found){view.patch({feedback:''});jump(id);}else {view.patch({feedback:'未能读取这一轮，请重试。'});onError(feedback.textContent!);}
    }catch{if(isCurrent()){view.patch({feedback:'读取失败，请重试。'});onError(feedback.textContent!);}}
    finally{if(isCurrent())view.patch({busy:'false'});}
  }
  function openDirectory(){hide();renderList();dialog.showModal();const active=list.querySelector<HTMLElement>('[aria-current]');if(active)list.scrollTop=active.offsetTop-list.offsetTop-Math.max(0,(list.clientHeight-active.offsetHeight)/2);close.focus();void earlier();syncLoad();}
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{syncLoad();const target=directoryTarget;directoryTarget=null;if(target?.isConnected)target.focus({preventScroll:true});else(entry.checkVisibility()?entry:document.querySelector<HTMLElement>('#mobile-more>summary'))?.focus({preventScroll:true});});
  preview.addEventListener('pointerenter',()=>clearTimeout(hideTimer));preview.addEventListener('pointerleave',deferHide);
  document.addEventListener('pointerdown',e=>{if(!rail.contains(e.target as Node)&&!preview.contains(e.target as Node))hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!preview.hidden){hide();e.preventDefault();}});
  rail.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const entries=[...ticks.children as HTMLCollectionOf<HTMLElement>],index=entries.indexOf(document.activeElement as HTMLElement);if(index<0)return;e.preventDefault();entries[e.key==='Home'?0:e.key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();});
  function measure(){
    frame=null;const c=context(),r=scroller.getBoundingClientRect();const visible=c.visible&&(rows.length>0||c.hasEarlier)&&r.height>0;
    const complete=Boolean(turnCountLabel({...c,hasEarlier:pendingHistory(c),loading,loadMessage},rows.length));
    view.patch({railHidden:!visible||!complete||compactLayout(),entryHidden:!visible||!complete});
    document.querySelector('.main-panel')!.classList.toggle('has-turn-navigation',visible);
    rail.style.left=(r.left+4)+'px';rail.style.top=(r.top+12)+'px';rail.style.height=Math.max(0,r.height-24)+'px';
    const active=reading();currentId=owners.get(active?.dataset.turnId);
    view.current(currentId);
    if(!restore&&key&&active)positions.set(key,{id:active.dataset.turnId,offset:active.getBoundingClientRect().top-r.top,following:follow.following});
    if(positions.size>50)positions.delete(positions.keys().next().value!);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  function switchContext(next:string|undefined){
    if(next===key)return;key=next;restore=positions.get(next!)||null;signature='';hide();if(dialog.open)dialog.close();loadVersion++;loading=false;loadMessage='';autoStarted=false;directory=null;navigationVersion++;view.patch({feedback:''});
  }
  function update(){
    const c=context(),live=new Map(c.turns.map(t=>[t.id,t]));
    const ordered=directory?directory.map(t=>{const value=live.get(t.id)||t;live.delete(t.id);return value;}).concat([...live.values()]):c.turns;
    const index=navigationIndex(ordered);owners=index.owners;
    const next=index.inputs.map(t=>turnPreview(t,{uncertain:c.uncertain})),sig=JSON.stringify(next);
    rows=next;
    if(sig!==signature){signature=sig;view.renderTicks(rows);
      if(dialog.open)renderList();if(hovered){const row=rows.find(r=>r.id===hovered);if(row)show(row,buttons.get(row.id)!);else hide();}
    }
    if(restore&&rows.length){const target=locate(restore.id);if(restore.following){follow.reset();restore=null;}else if(target){follow.pause({sticky:true});scroller.scrollTop+=target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-restore.offset;restore=null;}else if(!c.hasEarlier&&!c.rendering){restore=null;}}
    syncLoad();schedule();
    if(key&&!autoStarted&&!loading&&c.visible&&c.ready&&pendingHistory(c))void earlier({automatic:true});
  }
  for(const event of ['wheel','touchstart','keydown'])scroller.addEventListener(event,()=>{restore=null;},{passive:true});
  ticks.addEventListener('scroll',hide,{passive:true});
  scroller.addEventListener('scroll',()=>{hide();schedule();},{passive:true});window.addEventListener('resize',()=>{hide();schedule();});new ResizeObserver(schedule).observe(scroller);
  return {update,switchContext};
}
