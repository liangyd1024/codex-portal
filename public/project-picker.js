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
  trigger.disabled = select.disabled || !select.options.length;
  if (dialog.open && (page.hidden || select.disabled || !media.matches)) close();
  else if (dialog.open && renderedOptions !== optionSignature()) renderList();
}
trigger.addEventListener('click', () => {
  sync();
  if (trigger.disabled || page.hidden || !media.matches) return;
  search.value = '';
  renderList();
  dialog.showModal();
  trigger.setAttribute('aria-expanded', 'true');
  list.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest'});
});
dialog.querySelector('header button').addEventListener('click', close);
dialog.addEventListener('cancel', event => {if (composing || Date.now() - compositionEnded < 100) event.preventDefault();});
dialog.addEventListener('close', () => {
  trigger.setAttribute('aria-expanded', 'false');
  if (!page.hidden) (media.matches ? trigger : select).focus({preventScroll:true});
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
media.addEventListener('change', sync);
sync();
