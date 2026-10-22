// Keep the existing per-host, per-tab storage format compatible with browser backups.
export class DraftStore extends Map {
  constructor({storage, host, onError = () => {}}) {
    super();
    Object.assign(this, {storage, key:'rcm.drafts.' + host, onError, revisions:new Map(), warned:false});
    try {
      const entries = JSON.parse(this.backend().getItem(this.key) || '[]');
      if (Array.isArray(entries)) for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') super.set(...entry);
      }
    } catch {}
  }
  backend() { return typeof this.storage === 'function' ? this.storage() : this.storage; }
  persist() {
    try { this.backend().setItem(this.key, JSON.stringify([...this])); this.warned = false; }
    catch { if (!this.warned) { this.warned = true; this.onError(); } }
  }
  set(id, text) {
    if (this.get(id) !== text) this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    super.set(id, text); this.persist(); return this;
  }
  delete(id) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    const removed = super.delete(id); this.persist(); return removed;
  }
  capture(id, text) {
    this.set(id, text);
    return {id, text, revision:this.revisions.get(id)};
  }
  acknowledge(sent) {
    if (this.get(sent.id) !== sent.text || this.revisions.get(sent.id) !== sent.revision) return false;
    this.delete(sent.id); return true;
  }
}

export function shouldSendOnEnter(event, {touch = false, composing = false, compositionEnded = -Infinity, now = performance.now()} = {}) {
  return event.key === 'Enter' && !event.shiftKey && !touch && !composing && !event.isComposing &&
    event.keyCode !== 229 && now - compositionEnded > 50;
}

export function coalesceRefresh(refresh) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(refresh).finally(() => { pending = null; });
    return pending;
  };
}

// Desktop Codex uses the modified Enter chord for the alternate follow-up action.
export function followUpAction({active,touch=false,alternate=false}) {
  if(!active)return 'message';
  return touch&&!alternate||!touch&&alternate?'steer':'queue';
}
