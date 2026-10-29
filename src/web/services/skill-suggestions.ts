import type {ApiOptions} from './api';
export interface SuggestionEntry {id?:string;path?:string;name?:string;title?:string;description?:string;shortDescription?:string;scope?:string;pluginId?:string;enabled?:boolean;installed?:boolean;archived?:boolean;ephemeral?:boolean;threadSource?:string;cwd?:string;mentionKind?:string;interface?:{displayName?:string;shortDescription?:string};skills?:SuggestionEntry[];errors?:unknown[];[field:string]:unknown}
interface Query {start:number;end:number;query:string;kind?:string}
interface Catalog {data?:SuggestionEntry[];error?:string;plugins?:Catalog;skills?:Catalog;apps?:Catalog;marketplaces?:{plugins?:SuggestionEntry[]}[];marketplaceLoadErrors?:unknown[];nextCursor?:string}
interface Options {input:HTMLTextAreaElement;api:<T=unknown>(path:string,options?:ApiOptions)=>Promise<T>;context:()=>{id:string|null;cwd?:string;desktop?:boolean;ready:boolean;busy:boolean;threadReferencesSupported?:boolean|null};select:(entry:SuggestionEntry,range:Query,kind:'skills'|'plugins'|'threads'|'files'|'apps')=>unknown}
interface ViewOptions {box:HTMLElement;choose:(entry:SuggestionEntry)=>void}
interface View {text:(value:string)=>void;render:(content:{label:string;kind:string;rows:SuggestionEntry[];messages:string[]})=>void;highlight:(index:number)=>void}
export function skillQuery(value:string, caret:number):Query|null {
  const match=value.slice(0,caret).match(/(?:^|\s)([/$])([^\s/$]*)$/u);
  return match?{start:caret-match[2].length-1,end:caret,query:match[2].toLowerCase()}:null;
}

export function pluginQuery(value:string, caret:number):Query|null {
  const match=value.slice(0,caret).match(/(?:^|\s)@([^\s@$]*)$/u);
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
  const choose=(entry:SuggestionEntry)=>{if(!query||input.disabled||!context().ready||context().busy)return;const range={...query};close();select(entry,range,(entry.mentionKind||query.kind||'skills') as 'skills'|'plugins'|'threads'|'files'|'apps');};
  const view=installSkillSuggestionsView({box,choose});
  async function update(){
    close();rows=[];index=0;if(composing||input.disabled||!context().ready||context().busy)return;
    query=pluginQuery(input.value,input.selectionStart)||skillQuery(input.value,input.selectionStart);if(!query)return;
    const desktop=context().desktop;
    const kind=query.kind==='plugins'?'mentions':'skills',label=kind==='mentions'?'文件、会话与能力':'技能';
    query.kind=kind;box.setAttribute('aria-label',label);
    const stamp=version,id=context().id,cwd=context().cwd,value=input.value,caret=input.selectionStart;
    view.text('');box.hidden=false;input.setAttribute('aria-expanded','true');position();view.text('正在读取'+label+'…');input.removeAttribute('aria-activedescendant');
    try{
      let source:Catalog,loadErrors:string[]=[];
      if(kind==='mentions'){
        await new Promise(resolve=>setTimeout(resolve,180));if(stamp!==version)return;
        const needle=query.query,capability=context().threadReferencesSupported;
        const current=()=>stamp===version&&context().id===id&&context().cwd===cwd&&input.value===value&&input.selectionStart===caret;
        const groups=new Map<string,SuggestionEntry[]>(),errors=new Map<string,string>(),loading=new Set<string>();
        const hints=()=>[
          ...(!needle?['输入文件名或相对路径可搜索当前项目文件。']:[]),
          ...(desktop&&capability!==true?[capability===false?'此会话未启用原生会话引用。请在 Codex 桌面新建会话后重试。':'尚未确认此会话的引用能力。可刷新会话或恢复桌面连接后重试；文件和其他能力仍可使用。']:[])
        ];
        const publish=()=>{
          if(!current())return;
          const selected=rows[index],key=selected&&selected.mentionKind+':'+selected.path;
          rows=['files','threads','skills','plugins','apps'].flatMap(kind=>groups.get(kind)||[]);
          index=key?Math.max(0,rows.findIndex(e=>e.mentionKind+':'+e.path===key)):0;
          const messages=[...hints(),...errors.values()];
          if(loading.size)messages.push('正在读取'+[...loading].join('、')+'…');
          else if(!rows.length)messages.push('没有匹配结果。');
          view.render({label,kind,rows:[...rows],messages});highlight();position();
        };
        const sources:{kind:string;label:string;path:string;map:(c:Catalog)=>SuggestionEntry[]}[]=[
          ...(!desktop||capability===true?[{kind:'threads',label:'会话',path:(desktop?'/api/desktop/candidates':'/api/thread-references')+'?search='+encodeURIComponent(needle),map:(c:Catalog)=>matchingThreads(c.data||[],id).map(e=>({...e,mentionKind:'threads'}))}]:[]),
          ...(needle?[{kind:'files',label:'文件',path:'/api/file-suggestions?cwd='+encodeURIComponent(cwd||'')+'&query='+encodeURIComponent(needle),map:(c:Catalog)=>c.data||[]}]:[]),
          ...(['skills','plugins','apps'] as const).map(kind=>({kind,label:({skills:'技能',plugins:'插件',apps:'应用'})[kind],path:'/api/composer?cwd='+encodeURIComponent(cwd||'')+'&kind='+kind,map:(c:Catalog)=>{
            const catalog=c[kind];if(!catalog||catalog.error)throw Error(catalog?.error||'目录未返回');
            const entries=kind==='skills'?matchingSkills((catalog.data||[]).flatMap(e=>e.skills||[]),needle):kind==='plugins'?matchingPlugins((catalog.marketplaces||[]).flatMap(e=>e.plugins||[]),needle):matchingSkills((catalog.data||[]).map(e=>({...e,path:e.id,enabled:e.isAccessible===true&&e.isEnabled===true})),needle);
            return entries.map(e=>({...e,mentionKind:kind}));
          }}))
        ];
        sources.forEach(s=>loading.add(s.label));publish();
        await loadSuggestionSources(sources,async s=>s.map(await api<Catalog>(s.path,{timeout:s.kind==='apps'?35000:12000})),(s,result,error)=>{
          if(!current())return;
          loading.delete(s.label);
          if(error)errors.set(s.kind,s.label+'暂时无法读取，重新输入可重试。');else groups.set(s.kind,result!);
          publish();
        });
        return;
      }else{
        const catalog=await api<Catalog>('/api/composer?cwd='+encodeURIComponent(cwd!)+'&kind='+kind);
        if(stamp!==version||context().id!==id||context().cwd!==cwd||input.value!==value||input.selectionStart!==caret)return;
        source=catalog[kind as 'skills']!;if(source.error)throw Error(source.error);
        rows=matchingSkills((source.data||[]).flatMap(e=>e.skills||[]),query.query);
      }
      const messages=[];
      if(!rows.length)messages.push('没有匹配的可用'+label+'。');
      if((source.data||[]).some(e=>e.errors?.length)||source.marketplaceLoadErrors?.length)messages.push('部分目录未能读取，请重新输入以重试。');
      for(const error of loadErrors)messages.push(error+'。');
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

// Each source publishes independently; a slow or failed catalog never hides ready rows.
export async function loadSuggestionSources<T,R>(sources:T[],read:(source:T)=>Promise<R>,publish:(source:T,result:R|undefined,error:unknown)=>void){
  await Promise.all(sources.map(async source=>{try{const result=await read(source);publish(source,result,null);}catch(error){publish(source,undefined,error);}}));
}
