import {useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
type Kind='skills'|'plugins';
interface Entry {path?:string;id?:string;name?:string;enabled?:boolean;missing?:boolean;description?:string;disabledReason?:string;interface?:{displayName?:string;shortDescription?:string};[key:string]:unknown}
interface Context {id:string|null;cwd:string}
interface Source {error?:string;data?:{skills?:Entry[];errors?:unknown[]}[];marketplaces?:{plugins?:Entry[]}[];marketplaceLoadErrors?:unknown[]}
interface Options {dialog:HTMLDialogElement;input:HTMLTextAreaElement;context:()=>Context;open:(title:string,button:HTMLElement)=>Context;version:()=>number;api:(path:string)=>Promise<Record<Kind,Source>>;choice:()=>Record<Kind,string[]>;present:()=>{kind:string;key:string;start:number;end:number}[];insertReference:(entry:Entry,kind:Kind)=>unknown;syncReferences:()=>void;save:()=>void;render:()=>void;loading:(value:boolean)=>void}
interface Row {entry:Entry;key:string;search:string;checked:boolean;description:string}
interface View {kind:Kind;phase:'pending'|'ready'|'error';rows:Row[];partial:boolean;error?:string;query:string;search:(value:string)=>void;change:(index:number,checked:boolean)=>void;retry:()=>void}
interface Instance {id:number;dialog:HTMLDialogElement;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Catalog({dialog,store}:Instance){
 const v=useStore(store).view,search=useRef<HTMLInputElement>(null);if(!v)return null;
 const name=v.kind==='skills'?'技能':'插件';
 return createPortal(v.phase==='pending'?<p role="status">正在读取目标机器…</p>:v.phase==='error'?<><p role="status">{'暂时无法加载'+name+'，请重试。你的草稿已保留。'}</p><details><summary>错误详情</summary><p>{v.error}</p></details><button type="button" onClick={v.retry}>重试</button></>:<><input ref={search} type="search" placeholder="搜索" aria-label={'搜索'+name} onInput={e=>v.search(e.currentTarget.value)}/><div className="composer-catalog">{!v.rows.length&&<p>{v.kind==='skills'?'此项目暂无技能。':'目标机器暂无已安装插件。'}</p>}{v.rows.map((r,i)=><label key={i} className="composer-catalog-item" data-search={r.search} hidden={!r.search.includes(v.query)}><input type="checkbox" checked={r.checked} disabled={!r.entry.enabled&&!r.checked} onChange={e=>v.change(i,e.currentTarget.checked)}/><span><strong>{r.entry.interface?.displayName||r.entry.name}</strong><small>{r.description}</small></span></label>)}<p hidden={!v.rows.length||v.rows.some(r=>r.search.includes(v.query))} role="status">{'没有匹配的'+name+'。'}</p></div>{v.partial&&<><p role="status">部分目录未能读取，列表可能不完整。已有选择仍保留。</p><button type="button" onClick={v.retry}>重新读取</button></>}<p>选择后在下一条消息中使用。插件安装及账号授权请在 Codex 中管理。</p></>,dialog);
}
export function ComposerCatalogs(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Catalog key={instance.id} {...instance}/>)}</>;}
export function installReactComposerCatalog(o:Options){
 const store=createStore<{view:View|null}>(()=>({view:null}));flushSync(()=>registry.setState({instances:[...registry.getState().instances,{id:++sequence,dialog:o.dialog,store}]}));
 const publish=(view:View|null)=>flushSync(()=>store.setState({view}));
 async function picker(kind:Kind,button:HTMLElement){
  o.dialog.classList.add('catalog-dialog');const current=o.open(kind==='skills'?'选择技能':'已安装插件',button),id=current.id,version=o.version();
  const same=()=>o.context().id===id&&o.context().cwd===current.cwd&&o.dialog.open&&version===o.version();
  const retry=()=>{o.dialog.close();void picker(kind,button);};
  const view:View={kind,phase:'pending',rows:[],partial:false,query:'',retry,search(value){view.query=value.trim().toLowerCase();publish({...view});},change(index,checked){
   if(o.context().id!==id)return;const row=view.rows[index]!;row.checked=checked;
   if(checked){o.dialog.close();o.insertReference(row.entry,kind);}else{for(const range of o.present().filter(r=>r.kind===kind&&r.key===row.key).reverse())o.input.setRangeText('',range.start,range.end,'end');o.syncReferences();o.save();o.render();o.input.dispatchEvent(new Event('input',{bubbles:true}));}
   publish({...view});
  }};publish(view);o.loading(true);
  try{
   const catalog=await o.api('/api/composer?cwd='+encodeURIComponent(current.cwd)+'&kind='+kind);if(!same())return;
   const source=catalog[kind];if(source.error)throw Error(source.error);
   const entries=kind==='skills'?(source.data||[]).flatMap(e=>e.skills||[]):(source.marketplaces||[]).flatMap(e=>e.plugins||[]).filter(p=>p.installed);
   const seen=new Set<string|undefined>(),items=entries.filter(e=>{const key=e.path||e.id;if(seen.has(key))return false;seen.add(key);return true;});
   const errors=kind==='skills'?(source.data||[]).flatMap(e=>e.errors||[]):source.marketplaceLoadErrors||[];
   for(const key of o.choice()[kind])if(!seen.has(key))items.push({[kind==='skills'?'path':'id']:key,name:key,enabled:false,missing:true});
   view.rows=items.map(entry=>{const key=(kind==='skills'?entry.path:entry.id)!;const description=[entry.description||entry.interface?.shortDescription,!entry.enabled?(entry.missing?'目录中暂不可用，可取消选择后重试':(entry.disabledReason||'未启用')+'；已选项目可取消选择'):''].filter(Boolean).join(' · ');const body=(entry.interface?.displayName||entry.name||'')+description;return{entry,key,description,checked:o.present().some(r=>r.kind===kind&&r.key===key),search:[entry.name,entry.path,entry.id,body].filter(Boolean).join(' ').toLowerCase()};});
   view.phase='ready';view.partial=!!errors.length;publish({...view});o.dialog.querySelector<HTMLInputElement>('input[type=search]')!.focus();
  }catch(error){if(same()){view.phase='error';view.error=(error as {message:string}).message;publish({...view});}}finally{o.loading(false);}
 }
 return {picker,clear:()=>publish(null)};
}
