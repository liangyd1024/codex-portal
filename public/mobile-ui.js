// One breakpoint for both CSS and behavior, including phones rotated to landscape.
export const COMPACT_QUERY = '(max-width: 700px), (pointer: coarse) and (max-width: 1050px) and (max-height: 600px)';
export const compactLayout = () => matchMedia(COMPACT_QUERY).matches;
export const touchInput = () => matchMedia('(pointer: coarse)').matches;

export function installMobileUI({closeDrawers, layoutChanged}) {
  const root = document.documentElement, shell = document.getElementById('app-shell');
  const byId = id => document.getElementById(id);
  const main = document.querySelector('.main-panel'), sidebar = byId('sidebar'), inspector = byId('inspector');
  const more = document.createElement('details'); more.id = 'mobile-more';
  const summary = document.createElement('summary'); summary.className = 'icon-button';
  summary.textContent = '⋯'; summary.setAttribute('aria-label','更多操作');
  const panel = document.createElement('div'); panel.className = 'mobile-more-panel';
  more.append(summary,panel); byId('toggle-inspector').before(more);
  const toasts=byId('toasts'),toastMarker=document.createComment('desktop notifications');toasts.before(toastMarker);
  const takeoverSlot = document.createElement('div'); takeoverSlot.className = 'mobile-takeover';
  byId('message-form').before(takeoverSlot);
  const relocations = [byId('refresh-all'), byId('auto-refresh').closest('label'), byId('toggle-message-details'), byId('handoff-thread'), byId('takeover')].map(node => {
    const marker = document.createComment('desktop control'); node.before(marker); return {node,marker};
  });
  const refreshLabel = document.createElement('span'); refreshLabel.textContent = '刷新状态与会话';
  refreshLabel.className = 'mobile-control-label'; byId('refresh-all').append(refreshLabel);
  byId('auto-refresh').nextElementSibling.textContent = '自动刷新';
  const focusable = node => [...node.querySelectorAll('button, summary, input, select, textarea, a[href], [tabindex="0"]')]
    .filter(e => !e.disabled && !e.closest('[inert]') && e.getClientRects().length && e.checkVisibility?.({visibilityProperty:true}) !== false && getComputedStyle(e).visibility !== 'hidden');
  let activeDrawer = null, returnTo = null;
  function syncDrawers() {
    const next = compactLayout() ? shell.classList.contains('sidebar-open') ? sidebar : !shell.classList.contains('inspector-hidden') ? inspector : null : null;
    main.inert = Boolean(next); sidebar.inert = next === inspector; inspector.inert = next === sidebar;
    for (const drawer of [sidebar,inspector]) {
      if (drawer === next) { drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-modal','true'); }
      else { drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); }
    }
    if (next === activeDrawer) return;
    const previous = activeDrawer; activeDrawer = next;
    if (next) {
      more.open = false; byId('composer-settings').open = false;
      returnTo = next === sidebar ? byId('open-sidebar') : byId('toggle-inspector');
      (next.querySelector('button') || next).focus({preventScroll:true});
    } else if (previous && !document.querySelector('dialog[open]')) {
      returnTo?.focus({preventScroll:true});
    }
  }
  new MutationObserver(syncDrawers).observe(shell,{attributes:true,attributeFilter:['class']});
  function positionPanels() {
    if (!compactLayout()) return;
    const view = window.visualViewport;
    const top = view?.offsetTop || 0, height = view?.height || innerHeight;
    const settings = byId('composer-settings'), controls = settings.querySelector('.model-controls');
    const composerTop = byId('message-form').getBoundingClientRect().top;
    const bottom = Math.max(top + 12, Math.min(top + height - 8, composerTop - 8));
    controls.style.setProperty('--model-panel-bottom', (innerHeight - bottom) + 'px');
    controls.style.setProperty('--model-panel-height', Math.max(44,bottom - top - 8) + 'px');
    panel.style.setProperty('--menu-top', summary.getBoundingClientRect().bottom + 8 + 'px');
    panel.style.setProperty('--menu-height', Math.max(44,top + height - summary.getBoundingClientRect().bottom - 16) + 'px');
  }
  let frame;
  function updateViewport() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const view = window.visualViewport;
      root.style.setProperty('--visual-height', (view?.height || innerHeight) + 'px');
      root.style.setProperty('--visual-top', (view?.offsetTop || 0) + 'px');
      root.style.setProperty('--visual-width', (view?.width || innerWidth) + 'px');
      positionPanels();
    });
  }
  function applyLayout() {
    const mobile = compactLayout(); root.classList.toggle('mobile-layout',mobile);
    if(mobile)document.querySelector('.topbar').after(toasts);else toastMarker.after(toasts);
    more.open = false; byId('composer-settings').open = false;
    for (const {node,marker} of relocations) {
      if (mobile) (node.id === 'takeover' ? takeoverSlot : panel).append(node);
      else marker.after(node);
      const reason = byId('reason-' + node.id); if (reason) node.after(reason);
    }
    layoutChanged(mobile); syncDrawers(); updateViewport();
  }
  more.addEventListener('toggle',() => {
    if (more.open) { byId('composer-settings').open = false; positionPanels(); }
    summary.setAttribute('aria-expanded',String(more.open));
  });
  byId('composer-settings').addEventListener('toggle',() => {
    if (byId('composer-settings').open) { more.open = false; positionPanels(); }
  });
  new ResizeObserver(positionPanels).observe(byId('message-form'));
  document.addEventListener('pointerdown',event => { if (!more.contains(event.target)) more.open = false; });
  panel.addEventListener('click',event => {
    const button = event.target.closest('button');
    if (button && !button.disabled) { more.open = false; summary.focus({preventScroll:true}); }
  },true);
  document.addEventListener('keydown',event => {
    if (event.defaultPrevented || document.querySelector('dialog[open], .sidebar-menu')) return;
    const settings = byId('composer-settings');
    if (event.key === 'Escape') {
      if (more.open) { more.open = false; summary.focus(); }
      else if (settings.open) { settings.open = false; settings.querySelector('summary').focus(); }
      else if (activeDrawer) closeDrawers();
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    }
    const scope = more.open ? more : activeDrawer;
    if (event.key === 'Tab' && scope) {
      const nodes = focusable(scope), index = nodes.indexOf(document.activeElement);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    }
  });
  const query = matchMedia(COMPACT_QUERY); query.addEventListener('change',applyLayout);
  window.visualViewport?.addEventListener('resize',updateViewport);
  window.visualViewport?.addEventListener('scroll',updateViewport);
  window.addEventListener('resize',updateViewport);
  window.addEventListener('pageshow',updateViewport);
  applyLayout();
  return {syncDrawers, updateViewport};
}

// Following is a reading preference, not a distance remeasured after layout changes.
export function installScrollFollow(scroller,content) {
  let following=true,frame=0,touchY=null,dragging=false;
  const controls=document.createElement('div');controls.className='latest-message-controls';
  const button=document.createElement('button');button.type='button';button.className='latest-message-button';
  button.textContent='↓';button.title='回到最新';button.setAttribute('aria-label','回到最新');button.hidden=true;
  controls.append(button);scroller.after(controls);
  const nearBottom=()=>scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<40;
  const update=()=>{button.hidden=following||nearBottom()||!scroller.clientHeight;};
  const schedule=()=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{if(following)scroller.scrollTop=scroller.scrollHeight;update();});
  };
  const pause=()=>{following=false;cancelAnimationFrame(frame);update();};
  const latest=()=>{following=true;schedule();};
  button.addEventListener('click',latest);
  scroller.addEventListener('wheel',e=>{if(e.deltaY<0)pause();},{passive:true});
  scroller.addEventListener('touchstart',e=>{touchY=e.touches[0]?.clientY;},{passive:true});
  scroller.addEventListener('touchmove',e=>{const y=e.touches[0]?.clientY;if(touchY!=null&&y>touchY+2)pause();touchY=y;},{passive:true});
  scroller.addEventListener('keydown',e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))pause();});
  scroller.addEventListener('pointerdown',e=>{dragging=e.pointerType==='mouse';});
  window.addEventListener('pointerup',()=>{dragging=false;});
  window.addEventListener('pointercancel',()=>{dragging=false;});
  scroller.addEventListener('scroll',()=>{
    if(dragging)following=nearBottom();
    else if(nearBottom())following=true;
    update();
  },{passive:true});
  const observer=new ResizeObserver(schedule);observer.observe(scroller);observer.observe(content);
  return {get following(){return following;},reset:latest,schedule};
}
