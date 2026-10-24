// Reconcile the conversation in place so streamed text never remounts history.
const key = node => node.nodeType === 1
  ? node.dataset.turnId || node.dataset.messageId || node.dataset.itemId || '' : '';
const retained = new WeakMap();
export function retainMessage(node) {
  const marker = document.createTextNode(''); retained.set(marker, node); return marker;
}
function materialize(node) {
  for (const child of [...node.childNodes]) {
    const original = retained.get(child);
    if (original) child.replaceWith(original);
    else if (child.nodeType === 1) materialize(child);
  }
  return node;
}
export function reconcileMessages(parent, next) {
  const keyed = new Map([...parent.childNodes].filter(key).map(node => [key(node), node]));
  let cursor = parent.firstChild;
  for (const marker of [...next.childNodes]) {
    const fresh = retained.get(marker) || marker;
    const candidate = key(fresh) ? keyed.get(key(fresh)) : cursor && !key(cursor) ? cursor : null;
    const node = candidate ? reconcileNode(candidate, fresh) : fresh;
    if (candidate && node !== candidate) {
      const atCursor = candidate === cursor;
      candidate.replaceWith(node);
      if (atCursor) cursor = node;
    }
    if (node !== cursor) parent.insertBefore(node, cursor);
    if (!candidate || node !== candidate) materialize(node);
    cursor = node.nextSibling;
  }
  while (cursor) { const nextNode = cursor.nextSibling; cursor.remove(); cursor = nextNode; }
}
function reconcileNode(old, fresh) {
  if (old === fresh) return old;
  if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName || key(old) !== key(fresh)) return fresh;
  if (old.nodeType === 3) {
    if (old.data !== fresh.data) old.data = fresh.data;
    return old;
  }
  // These widgets have closures bound to their own DOM. Preserve the whole widget
  // when unchanged, otherwise install its new handlers together with its nodes.
  if (old.matches('.turn-file-changes')) return fresh;
  if (old.matches('.message-image')) {
    return fresh.matches('.message-image') && old.dataset.source === fresh.dataset.source ? old : fresh;
  }
  // Unchanged tool nodes are retained by RenderCache above. A fresh deferred
  // tool can have identical empty markup but a different payload closure.
  if (old.ontoggle) {
    if (old.hasAttribute('open')) fresh.setAttribute('open','');
    return fresh;
  }
  if (old.matches('.mermaid-block') && fresh.matches('.mermaid-block') && old.dataset.mermaidSource === fresh.dataset.mermaidSource) return old;
  if (old.matches('.code-block,.command-output-view,.decision-notice') || old.onclick || old.oninput || old.onblur) {
    return old.isEqualNode(fresh) ? old : fresh;
  }
  for (const attr of [...old.attributes]) {
    if (attr.name === 'open' && old.tagName === 'DETAILS') continue;
    if (!fresh.hasAttribute(attr.name)) old.removeAttribute(attr.name);
  }
  for (const attr of fresh.attributes) {
    if (attr.name === 'open' && old.tagName === 'DETAILS') continue;
    if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
  }
  reconcileMessages(old, fresh);
  return old;
}
