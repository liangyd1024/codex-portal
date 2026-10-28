// Touch-only shortcuts. Native vertical scrolling and text editing keep priority.
export function installDrawerGestures({surface, mode, openSidebar, closeDrawers}: {
  surface: HTMLElement;
  mode: () => 'main' | 'sidebar' | 'inspector' | 'sideChat' | null;
  openSidebar: () => void;
  closeDrawers: () => void;
}) {
  type Gesture = {id: number; x: number; y: number; started: number; mode: 'main' | 'sidebar' | 'inspector' | 'sideChat'; horizontal: boolean};
  let gesture: Gesture | null = null, suppressClickUntil = 0;
  const reset = () => {gesture = null;};
  surface.addEventListener('touchstart', event => {
    reset(); suppressClickUntil = 0;
    const current = mode(), target = event.target;
    if (!current || event.touches.length !== 1 || !(target instanceof Element)) return;
    if (document.querySelector('dialog[open], .sidebar-menu, #mobile-more[open], #composer-settings[open], .side-chat-panel .composer-settings[open]') || window.getSelection()?.toString()) return;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]')) return;
    if (current === 'main' && target.closest('button, a, summary, label')) return;
    for (let node: Element | null = target; node && node !== surface; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
    }
    const touch = event.touches[0];
    // Opening belongs to the left screen edge; closing remains available in either drawer.
    if ((current === 'main' || current === 'sideChat') && touch.clientX > 24) return;
    gesture = {id:touch.identifier,x:touch.clientX,y:touch.clientY,started:event.timeStamp,mode:current,horizontal:false};
  },{passive:true});
  surface.addEventListener('touchmove', event => {
    if (!gesture) return;
    const touch = [...event.touches].find(t => t.identifier === gesture!.id);
    if (!touch || event.touches.length !== 1 || mode() !== gesture.mode) {reset();return;}
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {reset();return;}
      if (Math.abs(dx) < 12) return;
      const direction = gesture.mode === 'sidebar' ? -1 : 1;
      if (dx * direction <= 0 || Math.abs(dx) < Math.abs(dy) * 1.5) {reset();return;}
      gesture.horizontal = true;
      suppressClickUntil = Date.now() + 2000;
    }
    if (event.cancelable) event.preventDefault();
    else reset();
  },{passive:false});
  surface.addEventListener('touchend', event => {
    const current = gesture;reset();
    if (!current || !current.horizontal || event.touches.length || mode() !== current.mode) return;
    const touch = [...event.changedTouches].find(t => t.identifier === current.id);
    if (!touch || event.timeStamp - current.started > (current.mode === 'main' ? 900 : 1500) || window.getSelection()?.toString()) return;
    const dx = touch.clientX - current.x, dy = touch.clientY - current.y;
    const direction = current.mode === 'sidebar' ? -1 : 1;
    if (dx * direction < (current.mode === 'main' ? 64 : 40) || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (event.cancelable) event.preventDefault();
    if (current.mode === 'main') openSidebar();else closeDrawers();
  },{passive:false});
  surface.addEventListener('touchcancel',reset,{passive:true});
  // Swiping a row must not also activate its button or link. A new touch clears this guard.
  surface.addEventListener('click', event => {
    if (event.detail && Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
}
