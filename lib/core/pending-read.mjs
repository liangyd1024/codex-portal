const pending = new WeakMap();
// Share only in-flight reads. A later refresh always reads the source again.
export function shareRead(owner, key, read) {
  let entries = pending.get(owner);
  if (!entries) { entries = new Map(); pending.set(owner, entries); }
  if (entries.has(key)) return entries.get(key);
  const promise = Promise.resolve().then(read);
  entries.set(key, promise);
  const clear = () => { if (entries.get(key) === promise) entries.delete(key); };
  promise.then(clear, clear);
  return promise;
}
