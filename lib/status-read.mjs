const pendingReads = new WeakMap();
const methods = new Set(['account/read','thread/goal/get','thread/queue/list','thread/backgroundTerminals/list']);

// Share only in-flight, read-only requests. Never cache a completed state or
// retry a mutation; each later refresh must observe the engine again.
export async function readLiveStatus(manager, method, params = {}) {
  if (!methods.has(method)) throw new TypeError('Unsupported status read: ' + method);
  manager.requireConnected();
  const rpc = manager.rpc, generation = manager.generation;
  let reads = pendingReads.get(rpc);
  if (!reads) { reads = new Map(); pendingReads.set(rpc, reads); }
  const key = JSON.stringify([method, params]);
  let pending = reads.get(key);
  if (!pending) {
    // Status reads can queue behind engine work. Use the normal RPC deadline,
    // rather than treating a response after three seconds as a failed state.
    pending = Promise.resolve().then(() => rpc.request(method, params, {timeoutMs:30000}));
    reads.set(key, pending);
    const clear = () => { if (reads.get(key) === pending) reads.delete(key); };
    pending.then(clear, clear);
  }
  const result = await pending;
  manager.requireConnected();
  if (manager.rpc !== rpc || manager.generation !== generation) {
    throw Object.assign(new Error('连接已变化，请重新读取状态。'), {status:409, code:'CONNECTION_CHANGED'});
  }
  return result;
}
