import {retainMessage} from './message-dom.js';

// Cache only presentation nodes for the currently displayed conversation.
export class RenderCache {
  entries = new Map();
  clear() { this.entries.clear(); }
  render(key, stamp, build) {
    const old = this.entries.get(key);
    if (old?.stamp === stamp) return retainMessage(old.node);
    const node = build(); node.dataset.renderKey = key;
    this.entries.set(key, {stamp, node});
    return node;
  }
  bind(parent) {
    const present = new Set();
    for (const node of parent.querySelectorAll('[data-render-key]')) {
      const key = node.dataset.renderKey, entry = this.entries.get(key);
      if (entry) { entry.node = node; present.add(key); }
    }
    for (const key of this.entries.keys()) if (!present.has(key)) this.entries.delete(key);
  }
}

export const renderSignature = value => JSON.stringify(value, (key, entry) =>
  ['aggregatedOutput', 'outputToken'].includes(key) ? undefined : entry);

// Present the newest turn first. Older turns remain in the original data and
// are prepended in bounded batches, yielding a paint between batches.
export class ProgressiveTurns {
  constructor({render, schedule=callback=>{
    let timer;
    const frame=requestAnimationFrame(()=>{timer=setTimeout(callback,0);});
    return ()=>{cancelAnimationFrame(frame);clearTimeout(timer);};
  }, batch=4}) { this.render=render;this.schedule=schedule;this.batch=batch; }
  reset(key) {
    if(this.key===key)return;
    this.cancel?.();this.cancel=null;this.key=key;this.first=null;this.all=[];this.pending=false;
  }
  view(turns) {
    this.all=turns;
    let start=this.first==null?-1:turns.findIndex(t=>t.id===this.first);
    if(start<0)start=Math.max(0,turns.length-1);
    this.first=turns[start]?.id??null;this.pending=start>0;
    return turns.slice(start);
  }
  reveal(id) {
    const index=this.all.findIndex(t=>t.id===id),start=this.all.findIndex(t=>t.id===this.first);
    if(index<0||index>=start)return;
    this.first=id;this.render();
  }
  enqueue() {
    if(!this.pending||this.cancel)return;
    const key=this.key;
    this.cancel=this.schedule(()=>{
      if(this.key!==key)return;
      this.cancel=null;
      const start=this.all.findIndex(t=>t.id===this.first);
      this.first=this.all[Math.max(0,start-this.batch)]?.id??null;
      this.render();
    });
  }
}
