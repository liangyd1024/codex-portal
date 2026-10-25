interface LayoutDependencies {
  element: (id: string) => HTMLElement;
  compact: () => boolean;
}

/** Own only shell layout attributes and inline width; preserve the baseline events and storage. */
export function createLayoutController({element: $, compact: compactLayout}: LayoutDependencies) {
function saveLayout(key: string, value: unknown) { try { localStorage.setItem('rcm.layout.'+key, JSON.stringify(value)); } catch {} }
function readLayout<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem('rcm.layout.'+key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function setupResizableLayout() {
  const shell = $('app-shell'), panes = $('sidebar-sections');
  const widthHandle = $('sidebar-resizer');
  const savedWidth = readLayout('sidebarWidth',266), savedRatio = readLayout('threadsRatio',0.3);
  let width = typeof savedWidth === 'number' && Number.isFinite(savedWidth) ? savedWidth : 266;
  let ratio = typeof savedRatio === 'number' && Number.isFinite(savedRatio) ? savedRatio : 0.3;
  const clamp = (n: number,min: number,max: number) => Math.max(min,Math.min(max,n));
  function apply() {
    const inspectorWidth = window.innerWidth > 1050 && !shell.classList.contains('inspector-hidden') ? $('inspector').getBoundingClientRect().width : 0;
    const maxWidth = Math.max(220,Math.min(520,window.innerWidth - inspectorWidth - 380));
    const actualWidth = clamp(width,220,maxWidth);
    shell.style.setProperty('--sidebar',actualWidth+'px');
    widthHandle.setAttribute('aria-valuemin','220'); widthHandle.setAttribute('aria-valuemax',String(Math.round(maxWidth)));
    widthHandle.setAttribute('aria-valuenow',String(Math.round(actualWidth)));

  }
  function bind(handle: HTMLElement,vertical: boolean) {
    let drag: {id: number;x: number;y: number;width: number;height: number} | null = null;
    handle.addEventListener('pointerdown',event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId);
      drag = {id:event.pointerId,x:event.clientX,y:event.clientY,width:$('sidebar').getBoundingClientRect().width,height:0};
      document.body.classList.add('resizing-layout'); document.body.classList.toggle('resizing-sections',vertical);
    });
    handle.addEventListener('pointermove',event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (vertical) ratio = clamp((drag.height + drag.y - event.clientY) / Math.max(1,panes.clientHeight - 12),0,1);
      else width = clamp(drag.width + event.clientX - drag.x,220,Number(widthHandle.getAttribute('aria-valuemax')));
      apply();
    });
    const finish = () => {
      if (!drag) return;
      drag = null; document.body.classList.remove('resizing-layout','resizing-sections');
      saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio);
    };
    handle.addEventListener('pointerup',finish); handle.addEventListener('pointercancel',finish); handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('keydown',event => {
      const keys = vertical ? ['ArrowUp','ArrowDown'] : ['ArrowLeft','ArrowRight'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (vertical) ratio = clamp(ratio + (event.key === 'ArrowUp' ? 0.05 : -0.05),0,1);
      else width = clamp(width + (event.key === 'ArrowRight' ? 16 : -16),220,Number(widthHandle.getAttribute('aria-valuemax')));
      apply(); saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio);
    });
    handle.addEventListener('dblclick',() => { if (vertical) ratio = 0.3; else width = 266; apply(); saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio); });
  }
  bind(widthHandle,false);
  new ResizeObserver(apply).observe(panes);
  new MutationObserver(apply).observe(shell,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',apply); apply();
}
function toggleSidebar(open?: boolean, persist = true) {
  const shell = $('app-shell'); const mobile = compactLayout();
  const show = open ?? (mobile ? !shell.classList.contains('sidebar-open') : shell.classList.contains('sidebar-hidden'));
  shell.classList.toggle('sidebar-open', mobile && show);
  shell.classList.toggle('sidebar-hidden', !mobile && !show);
  $('open-sidebar').setAttribute('aria-expanded', String(show));
  if (mobile && show) toggleInspector(false);
  if (persist && !mobile) saveLayout('sidebar', show);
}
function toggleInspector(open?: boolean) {
  const shell = $('app-shell'); const show = open ?? shell.classList.contains('inspector-hidden');
  shell.classList.toggle('inspector-hidden', !show); $('toggle-inspector').setAttribute('aria-expanded',String(show));
  if (show && compactLayout()) toggleSidebar(false, false);
  if (show) $('inspector').querySelector<HTMLButtonElement>('.inspector-nav button[aria-pressed="true"]')?.click();
}
return {saveLayout,readLayout,setupResizableLayout,toggleSidebar,toggleInspector};
}
