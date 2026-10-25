import type {ApiOptions} from './api';
export interface SuggestionEntry {id?:string;path?:string;name?:string;title?:string;description?:string;shortDescription?:string;scope?:string;pluginId?:string;enabled?:boolean;installed?:boolean;archived?:boolean;ephemeral?:boolean;threadSource?:string;cwd?:string;mentionKind?:string;interface?:{displayName?:string;shortDescription?:string};skills?:SuggestionEntry[];errors?:unknown[];[field:string]:unknown}
interface Query {start:number;end:number;query:string;kind?:string}
interface Catalog {data?:SuggestionEntry[];error?:string;plugins?:Catalog;skills?:Catalog;marketplaces?:{plugins?:SuggestionEntry[]}[];marketplaceLoadErrors?:unknown[];nextCursor?:string}
interface Options {input:HTMLTextAreaElement;api:<T=unknown>(path:string,options?:ApiOptions)=>Promise<T>;context:()=>{id:string|null;cwd?:string;desktop?:boolean;ready:boolean;busy:boolean;threadReferencesSupported?:boolean};select:(entry:SuggestionEntry,range:Query,kind:'skills'|'plugins'|'threads')=>unknown}
interface ViewOptions {box:HTMLElement;choose:(entry:SuggestionEntry)=>void}
interface View {text:(value:string)=>void;render:(content:{label:string;kind:string;rows:SuggestionEntry[];messages:string[]})=>void;highlight:(index:number)=>void}
export function skillQuery(value:string, caret:number):Query|null {
  const match=value.slice(0,caret).match(/(?:^|\s)([/$])([^\s/$]*)$/u);
  return match?{start:caret-match[2].length-1,end:caret,query:match[2].toLowerCase()}:null;
}

export function pluginQuery(value:string, caret:number):Query|null {
  const match=value.slice(0,caret).match(/(?:^|\s)@([^\s/@$]*)$/u);
  return match?{start:caret-match[1].length-1,end:caret,query:match[1].toLowerCase(),kind:'plugins'}:null;
}

export function matchingPlugins(entries:SuggestionEntry[],query='') {
  return matchingSkills(entries.filter(e=>e.installed).map(e=>({...e,path:e.id})),query);
}

export function matchingThreads(entries:SuggestionEntry[], currentId:string|null) {
  const seen=new Set();
  return entries.filter(e=>e.id!==currentId&&!e.archived&&!e.ephemeral&&e.threadSource!=='ambient_suggestions'&&!seen.has(e.id)&&seen.add(e.id))
    .map(e=>({id:e.id,path:e.id,name:e.name||e.title||'未命名会话',description:(e.cwd||'').split('/').filter(Boolean).at(-1)||'',scope:'thread'}));
}

export function skillPresentation(entry:SuggestionEntry) {
  return {name:entry.interface?.displayName||entry.name,
    description:entry.interface?.shortDescription||entry.shortDescription||entry.description||'',
    source:entry.pluginId||(({user:'个人',repo:'项目',system:'系统',admin:'管理员'} as Record<string,string>)[entry.scope!]||'')};
}
export function matchingSkills<T extends SuggestionEntry>(entries:T[],query='') {
  const seen=new Set(),needle=query.toLowerCase();
  return entries.filter(entry=>{if(!entry.enabled||seen.has(entry.path))return false;seen.add(entry.path);return true;})
    .map((entry,index)=>{const view=skillPresentation(entry),names=[entry.name,view.name].map(n=>(n||'').toLowerCase());
      const rank=!needle?0:names.some(n=>n===needle)?0:names.some(n=>n.startsWith(needle))?1:names.some(n=>n.includes(needle))?2:
        [view.description,entry.description].some(d=>(d||'').toLowerCase().includes(needle))?3:4;
      return {entry,index,rank};})
    .filter(row=>row.rank<4).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(row=>row.entry);
}

export function installSkillSuggestions({input,api,context,select}:Options) {
  const box=document.createElement('div');box.className='skill-suggestions';box.id='skill-suggestions-'+crypto.randomUUID();box.hidden=true;box.setAttribute('role','listbox');box.setAttribute('aria-label','技能');document.body.append(box);
  input.setAttribute('aria-controls',box.id);input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');
  let version=0,rows:SuggestionEntry[]=[],index=0,query:Query|null=null,composing=false,ended=-Infinity;
  const close=()=>{version++;box.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const position=()=>{if(box.hidden)return;const r=input.getBoundingClientRect(),v=window.visualViewport;box.style.left=Math.max(8,r.left)+'px';box.style.width=Math.max(0,Math.min(r.width,(v?.width||innerWidth)-16))+'px';box.style.bottom=Math.max(8,innerHeight-r.top+8)+'px';box.style.maxHeight=Math.max(60,Math.min(300,r.top-(v?.offsetTop||0)-16))+'px';};
  const highlight=()=>{view.highlight(index);const node=box.querySelectorAll('[role=option]')[index];if(node){input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});}};
  const choose=(entry:SuggestionEntry)=>{if(!query||input.disabled||!context().ready||context().busy)return;const range={...query};close();select(entry,range,(entry.mentionKind||query.kind||'skills') as 'skills'|'plugins'|'threads');};
  const view=installSkillSuggestionsView({box,choose});
  async function update(){
    close();rows=[];if(composing||input.disabled||!context().ready||context().busy)return;
    query=pluginQuery(input.value,input.selectionStart)||skillQuery(input.value,input.selectionStart);if(!query)return;
    const desktop=context().desktop;
    if(desktop&&query.kind!=='plugins')return;
    const kind=desktop?'threads':query.kind==='plugins'?'mentions':'skills',label=kind==='threads'?'会话':kind==='mentions'?'会话与插件':'技能';
    query.kind=kind;box.setAttribute('aria-label',label);
    if(desktop&&!context().threadReferencesSupported){box.hidden=false;view.text('此桌面会话尚未确认支持会话引用，请在桌面新建支持引用的会话。');input.setAttribute('aria-expanded','true');position();return;}
    const stamp=version,id=context().id,cwd=context().cwd,value=input.value,caret=input.selectionStart;
    view.text('');box.hidden=false;input.setAttribute('aria-expanded','true');position();view.text('正在读取'+label+'…');input.removeAttribute('aria-activedescendant');
    try{
      let source:Catalog,loadErrors:string[]=[];
      if(kind==='threads'||kind==='mentions'){
        await new Promise(resolve=>setTimeout(resolve,180));if(stamp!==version)return;
        const reads=await Promise.allSettled([api<Catalog>((desktop?'/api/desktop/candidates':'/api/thread-references')+'?search='+encodeURIComponent(query.query)),...(kind==='mentions'?[api<Catalog>('/api/composer?cwd='+encodeURIComponent(cwd!)+'&kind=plugins')]:[])]);
        if(stamp!==version||context().id!==id||context().cwd!==cwd||input.value!==value||input.selectionStart!==caret)return;
        source=reads[0].status==='fulfilled'?reads[0].value:{data:[]};
        if(reads[0].status==='rejected')loadErrors.push('会话读取失败：'+reads[0].reason.message);
        rows=matchingThreads(source.data||[],id).map(e=>({...e,mentionKind:'threads'}));
        if(kind==='mentions'){
          const plugins=reads[1].status==='fulfilled'?reads[1].value.plugins:null;
          if(reads[1].status==='rejected'||plugins?.error)loadErrors.push('插件目录暂不可用');
          if(plugins)rows.push(...matchingPlugins((plugins.marketplaces||[]).flatMap(e=>e.plugins||[]),query.query).map(e=>({...e,mentionKind:'plugins'})));
        }
      }else{
        const catalog=await api<Catalog>('/api/composer?cwd='+encodeURIComponent(cwd!)+'&kind='+kind);
        if(stamp!==version||context().id!==id||context().cwd!==cwd||input.value!==value||input.selectionStart!==caret)return;
        source=catalog[kind as 'skills']!;if(source.error)throw Error(source.error);
        rows=matchingSkills((source.data||[]).flatMap(e=>e.skills||[]),query.query);
      }
      index=0;const messages=[];
      if(!rows.length)messages.push('没有匹配的可用'+label+'。');
      if((source.data||[]).some(e=>e.errors?.length)||source.marketplaceLoadErrors?.length)messages.push('部分目录未能读取，请重新输入以重试。');
      for(const error of loadErrors)messages.push(error+'。重新输入可重试。');
      if((kind==='threads'||kind==='mentions')&&source.nextCursor)messages.push('输入会话名称可查找更早的会话。');
      view.render({label,kind,rows,messages});
      highlight();position();
    }catch(error){if(stamp===version){rows=[];view.text(label+'读取失败，重新输入可重试：'+(error as Error).message);}}
  }
  input.addEventListener('input',()=>void update());input.addEventListener('click',()=>void update());
  input.addEventListener('compositionstart',()=>{composing=true;close();});input.addEventListener('compositionend',()=>{composing=false;ended=performance.now();void update();});
  input.addEventListener('keydown',e=>{
    if(box.hidden)return;
    if(e.isComposing||composing||e.keyCode===229||performance.now()-ended<100){if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();}return;}
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
    if(['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)&&rows.length){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Enter'||e.key==='Tab')choose(rows[index]);else{index=(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;highlight();}}
    else if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  input.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))close();});
  document.addEventListener('pointerdown',e=>{if(e.target!==input&&!box.contains(e.target as Node))close();});
  new ResizeObserver(position).observe(input);window.addEventListener('scroll',position,true);
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  return {close};
}

let suggestionsViewInstaller:((options:ViewOptions)=>View)|undefined;
export function configureSkillSuggestionsView(installer:NonNullable<typeof suggestionsViewInstaller>){suggestionsViewInstaller=installer;}
export function installSkillSuggestionsView(options:ViewOptions){
  if(!suggestionsViewInstaller)throw new Error('输入建议列表尚未初始化。');
  return suggestionsViewInstaller(options);
}
