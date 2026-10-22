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
