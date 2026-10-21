let folderBrowser;
export function configureProjectBrowser(options){folderBrowser=installProjectFolders(options);return folderBrowser;}
import {COMPACT_QUERY} from './mobile-ui.js';

// Keep the existing select as the source of truth for project IDs and draft updates.
const select = document.getElementById('new-cwd');
const page = document.getElementById('new-chat-page');
const trigger = document.createElement('button');
trigger.type = 'button';
trigger.id = 'project-picker-trigger';
trigger.setAttribute('aria-haspopup', 'dialog');
trigger.setAttribute('aria-controls', 'project-picker-dialog');
trigger.setAttribute('aria-expanded', 'false');
// A button must not live inside the select's label.
select.parentElement.after(trigger);
const dialog = document.createElement('dialog');
dialog.id = 'project-picker-dialog';
dialog.setAttribute('aria-labelledby', 'project-picker-title');
dialog.innerHTML = '<header><h2 id="project-picker-title">选择项目</h2><button type="button" class="icon-button" aria-label="关闭项目选择" autofocus>×</button></header><input id="project-picker-search" type="search" placeholder="搜索项目" aria-label="搜索项目" autocomplete="off" enterkeyhint="search"><div id="project-picker-list" aria-label="项目列表"></div><p id="project-picker-empty" role="status" hidden>未找到匹配项目</p>';
const browse=document.createElement('button');browse.type='button';browse.id='project-picker-browse';browse.textContent='浏览文件夹 / 新建项目';
dialog.append(browse);browse.onclick=()=>{dialog.close();folderBrowser?.open(trigger);};
document.body.append(dialog);
const search = dialog.querySelector('input');
const list = dialog.querySelector('#project-picker-list');
const empty = dialog.querySelector('#project-picker-empty');
const close = () => dialog.close();
const media = matchMedia(COMPACT_QUERY);
let composing = false, compositionEnded = 0, renderedOptions = '';
const optionSignature = () => JSON.stringify([...select.options].map(o => [o.label,o.value,o.selected,o.disabled,o.hidden]));
function renderList() {
  renderedOptions = optionSignature();
  const query = search.value.trim().toLocaleLowerCase();
  const options = [...select.options];
  const names = new Map();
  for (const option of options) names.set(option.label, (names.get(option.label) || 0) + 1);
  list.replaceChildren();
  for (const option of options.filter(o => !o.hidden && (o.label + ' ' + o.value).toLocaleLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-picker-option';
    button.disabled = option.disabled;
    button.setAttribute('aria-pressed', String(option.selected));
    const name = document.createElement('span');
    name.textContent = option.label;
    button.append(name);
    if (names.get(option.label) > 1) {
      const path = document.createElement('small');
      path.textContent = option.value;
      button.append(path);
    }
    button.addEventListener('click', () => {
      if (select.disabled || page.hidden || !option.isConnected) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', {bubbles:true}));
      sync();
      close();
    });
    list.append(button);
  }
  empty.hidden = Boolean(list.childElementCount);
  if (!options.length) empty.textContent = '暂无可选项目';
  else empty.textContent = '未找到匹配项目';
}
function sync() {
  const name = select.selectedOptions[0]?.label || '选择项目';
  trigger.textContent = name + ' ⌄';
  trigger.setAttribute('aria-label', '选择项目：' + name);
  trigger.disabled = select.disabled;
  if (dialog.open && (page.hidden || select.disabled)) close();
  else if (dialog.open && renderedOptions !== optionSignature()) renderList();
}
trigger.addEventListener('click', () => {
  sync();
  if (trigger.disabled || page.hidden) return;
  search.value = '';
  renderList();
  dialog.showModal();
  trigger.setAttribute('aria-expanded', 'true');
  if (!media.matches) search.focus({preventScroll:true});
  list.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest'});
});
dialog.querySelector('header button').addEventListener('click', close);
dialog.addEventListener('cancel', event => {if (composing || Date.now() - compositionEnded < 100) event.preventDefault();});
dialog.addEventListener('close', () => {
  trigger.setAttribute('aria-expanded', 'false');
  if (!page.hidden) trigger.focus({preventScroll:true});
});
let backdropDown = false;
dialog.addEventListener('pointerdown', event => {backdropDown = event.target === dialog;});
dialog.addEventListener('click', event => {if (backdropDown && event.target === dialog) close();});
search.addEventListener('input', () => {if (!composing) renderList();});
search.addEventListener('compositionstart', () => {composing = true;});
search.addEventListener('compositionend', () => {composing = false; compositionEnded = Date.now(); renderList();});
dialog.addEventListener('keydown', event => {
  if (event.isComposing || composing || event.keyCode === 229 || Date.now() - compositionEnded < 100) {
    event.stopPropagation();
    return;
  }
  if (event.key === 'Escape') {event.preventDefault(); close(); return;}
  // Enter in search never chooses a project or submits the conversation.
  if (event.target === search && event.key === 'Enter') event.preventDefault();
  if (['ArrowDown','ArrowUp'].includes(event.key)) {
    const buttons = [...list.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    if (buttons[next]) {event.preventDefault(); buttons[next].focus();}
  }
});
select.addEventListener('change', sync);
new MutationObserver(sync).observe(select, {childList:true,subtree:true,attributes:true,characterData:true});
new MutationObserver(sync).observe(page, {attributes:true,attributeFilter:['hidden']});
media.addEventListener('change', () => {if (dialog.open) close(); sync();});
sync();

export function installProjectFolders({api,context,onSelect,storage=sessionStorage}){
  const dialog=document.createElement('dialog');dialog.id='project-folders-dialog';dialog.setAttribute('aria-labelledby','project-folders-title');
  dialog.innerHTML=`<header><h2 id="project-folders-title">浏览文件夹</h2><button type="button" class="icon-button" aria-label="关闭文件夹浏览">×</button></header><p class="folder-target"></p><form class="folder-location"><label class="sr-only" for="folder-path">目标机器绝对路径</label><input id="folder-path" autocomplete="off" spellcheck="false"><button type="submit">前往</button></form><nav aria-label="目录操作"><button type="button" data-action="home">主目录</button><button type="button" data-action="up">上一级</button><button type="button" data-action="refresh">刷新</button><button type="button" data-action="new">新建文件夹</button></nav><form class="folder-create" hidden><label for="folder-name">文件夹名称</label><input id="folder-name" autocomplete="off" maxlength="255"><button type="submit">创建文件夹</button></form><label class="folder-hidden"><input type="checkbox">显示隐藏文件夹</label><div class="folder-list" aria-label="文件夹列表"></div><p class="folder-status" role="status" aria-live="polite"></p><p class="folder-limit">项目可在网页版使用，暂不会自动加入 Codex 桌面的项目列表。</p><footer><button type="button" class="primary-button folder-use">使用此文件夹</button></footer>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s),list=$('.folder-list'),status=$('.folder-status'),pathInput=$('#folder-path'),name=$('#folder-name'),create=$('.folder-create'),use=$('.folder-use');
  let cwd='',parent=null,entries=[],busy=false,epoch=0,contextKey='',composing=false,compositionEnded=0,returnFocus;
  const active=token=>dialog.open&&token===epoch&&context().ready;
  const pendingKeys=new Map();
  function keyFor(path){
    if(pendingKeys.has(path))return pendingKeys.get(path);
    const key='rcm.project-create.'+context().host+':'+path;
    let id;try{id=storage.getItem(key);}catch{}
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))id=crypto.randomUUID();
    // Persist before mutation; a reload can retry the same native request.
    try{storage.setItem(key,id);}catch{throw new Error('浏览器无法保存创建回执，请允许浏览器存储后重试。');}pendingKeys.set(path,id);return id;
  }
  function controls(){
    const ready=context().ready;
    dialog.setAttribute('aria-busy',String(busy));
    dialog.querySelectorAll('nav button,form button,form input,.folder-list button,.folder-hidden input').forEach(b=>b.disabled=busy||!ready);
    $('[data-action=up]').disabled=busy||!ready||!parent;
    $('[data-action=new]').disabled=busy||!ready||!cwd;
    use.disabled=busy||!ready||!cwd;use.textContent=busy?'正在处理…':'使用此文件夹';
  }
  function render(){
    list.replaceChildren();
    for(const entry of entries.filter(e=>$('.folder-hidden input').checked||!e.name.startsWith('.'))){
      const button=document.createElement('button');button.type='button';button.textContent=entry.name;button.title=entry.path;button.onclick=()=>load(entry.path);list.append(button);
    }
    if(!list.children.length){const text=document.createElement('p');text.textContent='此处没有可显示的子文件夹';list.append(text);}
    controls();
  }
  async function run(work){
    if(busy||!context().ready)return;
    const token=epoch;busy=true;status.textContent='正在处理…';controls();
    try{await work(token);}catch(error){if(active(token))status.textContent=error.message||'请求失败，请重试。';}
    finally{busy=false;controls();}
  }
  async function read(path,token){
    if(!active(token))return false;cwd='';parent=null;entries=[];list.replaceChildren();controls();
    const result=await api('/api/project-folders'+(path?'?path='+encodeURIComponent(path):''),{timeout:25000});
    if(!active(token))return false;
    cwd=result.path;parent=result.parent;entries=result.entries;pathInput.value=cwd;$('.folder-target').textContent='目标机器：'+result.hostName;status.textContent='';render();return true;
  }
  function load(path){return run(token=>read(path,token));}
  function sync(){
    const c=context(),key=c.host+':'+c.instance+':'+c.ready;
    if(key!==contextKey){contextKey=key;epoch++;if(dialog.open&&!c.ready)status.textContent='连接不可用，输入已保留。恢复连接后请刷新目录。';}
    if(dialog.open&&!c.open)dialog.close();controls();
  }
  $('.folder-location').onsubmit=e=>{e.preventDefault();if(!composing&&Date.now()-compositionEnded>=100)load(pathInput.value);};
  create.onsubmit=e=>{e.preventDefault();if(composing||Date.now()-compositionEnded<100)return;const parentPath=cwd,folderName=name.value;
    run(async token=>{const result=await api('/api/project-folders',{method:'POST',body:{parent:parentPath,name:folderName},timeout:25000});if(!active(token))return;create.hidden=true;name.value='';await read(result.path,token);});
  };
  use.onclick=()=>{const selected=cwd;run(async token=>{
    const idempotencyKey=keyFor(selected);
    const result=await api('/api/projects/open',{method:'POST',body:{path:selected,idempotencyKey},timeout:90000});
    if(!active(token))return;
    onSelect(result.project);
    pendingKeys.delete(selected);try{storage.removeItem('rcm.project-create.'+context().host+':'+selected);}catch{}
    dialog.close();
  });};
  $('header button').onclick=()=>dialog.close();
  $('[data-action=home]').onclick=()=>load();$('[data-action=up]').onclick=()=>load(parent);$('[data-action=refresh]').onclick=()=>load(cwd||pathInput.value||undefined);
  $('[data-action=new]').onclick=()=>{create.hidden=!create.hidden;if(!create.hidden)name.focus();};
  $('.folder-hidden input').onchange=render;
  dialog.addEventListener('compositionstart',()=>{composing=true;});dialog.addEventListener('compositionend',()=>{composing=false;compositionEnded=Date.now();});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||composing||event.keyCode===229||Date.now()-compositionEnded<100){if(event.key==='Enter')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();dialog.close();}});
  dialog.addEventListener('cancel',e=>{if(composing||Date.now()-compositionEnded<100)e.preventDefault();});
  dialog.addEventListener('close',()=>{epoch++;if(busy)status.textContent='请求可能仍在目标机器执行，请刷新目录核对后继续。';if(context().open)returnFocus?.focus();});
  return {sync,open(anchor){returnFocus=anchor;sync();if(!context().ready)return;epoch++;dialog.showModal();if(!busy)load(cwd||undefined);else status.textContent='上一请求仍在确认，请稍候。';}};
}
