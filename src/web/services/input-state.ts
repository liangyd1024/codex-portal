type StorageBackend=Pick<Storage,'getItem'|'setItem'>;
interface DraftOptions {storage:StorageBackend|(()=>StorageBackend);host:string;onError?:()=>void}
interface SentDraft {id:string;text:string;revision?:number}
// Keep the existing per-host, per-tab storage format compatible with browser backups.
export class DraftStore extends Map<string,string> {
  storage:DraftOptions['storage'];key:string;onError:()=>void;revisions:Map<string,number>;warned:boolean;
  constructor({storage, host, onError = () => {}}:DraftOptions) {
    super();
    this.storage=storage;this.key='rcm.drafts.'+host;this.onError=onError;this.revisions=new Map();this.warned=false;
    try {
      const entries = JSON.parse(this.backend().getItem(this.key) || '[]');
      if (Array.isArray(entries)) for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') super.set(entry[0],entry[1]);
      }
    } catch {}
  }
  get(id:string|null) { return super.get(id as string); }
  backend() { return typeof this.storage === 'function' ? this.storage() : this.storage; }
  persist() {
    try { this.backend().setItem(this.key, JSON.stringify([...this])); this.warned = false; }
    catch { if (!this.warned) { this.warned = true; this.onError(); } }
  }
  set(id:string, text:string) {
    if (this.get(id) !== text) this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    super.set(id, text); this.persist(); return this;
  }
  delete(id:string) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    const removed = super.delete(id); this.persist(); return removed;
  }
  capture(id:string, text:string) {
    this.set(id, text);
    return {id, text, revision:this.revisions.get(id)};
  }
  acknowledge(sent:SentDraft) {
    if (this.get(sent.id) !== sent.text || this.revisions.get(sent.id) !== sent.revision) return false;
    this.delete(sent.id); return true;
  }
}

export function shouldSendOnEnter(event:Pick<KeyboardEvent,'key'|'shiftKey'|'isComposing'|'keyCode'>, {touch = false, composing = false, compositionEnded = -Infinity, now = performance.now()} = {}) {
  return event.key === 'Enter' && !event.shiftKey && !touch && !composing && !event.isComposing &&
    event.keyCode !== 229 && now - compositionEnded > 50;
}

export function coalesceRefresh<T>(refresh:()=>T|PromiseLike<T>) {
  let pending:Promise<T>|null;
  return () => {
    if (!pending) pending = Promise.resolve().then(refresh).finally(() => { pending = null; });
    return pending;
  };
}

// Desktop Codex uses the modified Enter chord for the alternate follow-up action.
export function followUpAction({active,touch=false,alternate=false}:{active:boolean;touch?:boolean;alternate?:boolean}) {
  if(!active)return 'message';
  return touch&&!alternate||!touch&&alternate?'steer':'queue';
}
