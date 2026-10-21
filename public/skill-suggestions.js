export function skillQuery(value, caret) {
  const match=value.slice(0,caret).match(/(?:^|\s)([/$])([^\s/$]*)$/u);
  return match?{start:caret-match[2].length-1,end:caret,query:match[2].toLowerCase()}:null;
}

export function skillPresentation(entry) {
  return {name:entry.interface?.displayName||entry.name,
    description:entry.interface?.shortDescription||entry.shortDescription||entry.description||'',
    source:entry.pluginId||({user:'个人',repo:'项目',system:'系统',admin:'管理员'}[entry.scope]||'')};
}
export function matchingSkills(entries,query='') {
  const seen=new Set(),needle=query.toLowerCase();
  return entries.filter(entry=>{if(!entry.enabled||seen.has(entry.path))return false;seen.add(entry.path);return true;})
    .map((entry,index)=>{const view=skillPresentation(entry),names=[entry.name,view.name].map(n=>(n||'').toLowerCase());
      const rank=!needle?0:names.some(n=>n===needle)?0:names.some(n=>n.startsWith(needle))?1:names.some(n=>n.includes(needle))?2:
        [view.description,entry.description].some(d=>(d||'').toLowerCase().includes(needle))?3:4;
      return {entry,index,rank};})
    .filter(row=>row.rank<4).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(row=>row.entry);
}

export function installSkillSuggestions({input,api,context,select}) {
  const box=document.createElement('div');box.className='skill-suggestions';box.id='skill-suggestions';box.hidden=true;box.setAttribute('role','listbox');box.setAttribute('aria-label','技能');document.body.append(box);
  input.setAttribute('aria-controls',box.id);input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');
  let version=0,rows=[],index=0,query=null,composing=false,ended=-Infinity;
  const close=()=>{version++;box.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const position=()=>{if(box.hidden)return;const r=input.getBoundingClientRect(),v=window.visualViewport;box.style.left=Math.max(8,r.left)+'px';box.style.width=Math.max(0,Math.min(r.width,(v?.width||innerWidth)-16))+'px';box.style.bottom=Math.max(8,innerHeight-r.top+8)+'px';box.style.maxHeight=Math.max(60,Math.min(300,r.top-(v?.offsetTop||0)-16))+'px';};
  const highlight=()=>{[...box.querySelectorAll('[role=option]')].forEach((node,i)=>node.setAttribute('aria-selected',String(i===index)));const node=box.querySelectorAll('[role=option]')[index];if(node){input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});}};
  const choose=entry=>{if(!query||input.disabled||!context().ready||context().busy||context().active)return;const range={...query};close();select(entry,range);};
  async function update(){
    close();rows=[];if(composing||input.disabled||!context().ready||context().busy||context().active)return;
    query=skillQuery(input.value,input.selectionStart);if(!query)return;
    const stamp=version,id=context().id,cwd=context().cwd,value=input.value,caret=input.selectionStart;
    box.replaceChildren();box.hidden=false;input.setAttribute('aria-expanded','true');position();box.textContent='正在读取技能…';input.removeAttribute('aria-activedescendant');
    try{
      const catalog=await api('/api/composer?cwd='+encodeURIComponent(cwd)+'&kind=skills');
      if(stamp!==version||context().id!==id||context().cwd!==cwd||input.value!==value||input.selectionStart!==caret)return;
      if(catalog.skills.error)throw Error(catalog.skills.error);
      rows=matchingSkills((catalog.skills.data||[]).flatMap(e=>e.skills||[]),query.query);
      box.replaceChildren();index=0;
      const heading=document.createElement('div');heading.className='skill-suggestions-heading';heading.textContent='技能';box.append(heading);
      for(const [i,entry] of rows.entries()){
        const button=document.createElement('button');button.type='button';button.id='skill-option-'+i;button.setAttribute('role','option');
        const view=skillPresentation(entry);
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('icon');icon.setAttribute('aria-hidden','true');const use=document.createElementNS(icon.namespaceURI,'use');use.setAttribute('href','#i-mark');icon.append(use);
        const name=document.createElement('strong');name.textContent=view.name;name.title=entry.name;
        const description=document.createElement('span');description.className='skill-description';description.textContent=view.description;
        const source=document.createElement('span');source.className='skill-source';source.textContent=view.source;
        button.title=[view.name,view.description,view.source,entry.path].filter(Boolean).join('\n');
        button.append(icon,name,description,source);button.onpointerdown=e=>{if(e.pointerType==='mouse')e.preventDefault();};button.onclick=()=>choose(entry);box.append(button);
      }
      if(!rows.length)box.append(document.createTextNode('没有匹配的可用技能。'));
      if((catalog.skills.data||[]).some(e=>e.errors?.length))box.append(document.createTextNode('部分目录未能读取，请重新输入以重试。'));
      highlight();position();
    }catch(error){if(stamp===version){rows=[];box.textContent='技能读取失败，重新输入可重试：'+error.message;}}
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
  document.addEventListener('pointerdown',e=>{if(e.target!==input&&!box.contains(e.target))close();});
  new ResizeObserver(position).observe(input);window.addEventListener('scroll',position,true);
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  return {close};
}
