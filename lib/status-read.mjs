const pendingReads = new WeakMap();
const methods = new Set(['account/rateLimits/read','account/read','thread/goal/get','thread/queue/list','thread/backgroundTerminals/list']);

// A read started before a native mutation cannot verify its result. Existing
// callers keep their promises; subsequent callers share a new read.
export function invalidateLiveStatus(manager,method,params={}) {
  if(!methods.has(method))throw new TypeError('Unsupported status read: '+method);
  pendingReads.get(manager.rpc)?.delete(JSON.stringify([method,params,manager.accountRevision||0]));
}

// Share only in-flight, read-only requests. Never cache a completed state or
// retry a mutation; each later refresh must observe the engine again.
export async function readLiveStatus(manager, method, params = {}) {
  if (!methods.has(method)) throw new TypeError('Unsupported status read: ' + method);
  manager.requireConnected();
  const rpc = manager.rpc, generation = manager.generation;
  let reads = pendingReads.get(rpc);
  if (!reads) { reads = new Map(); pendingReads.set(rpc, reads); }
  const accountRevision = manager.accountRevision || 0;
  const key = JSON.stringify([method, params, accountRevision]);
  let pending = reads.get(key);
  if (!pending) {
    // Status reads can queue behind engine work. Use the normal RPC deadline,
    // rather than treating a response after three seconds as a failed state.
    pending = Promise.resolve().then(() => rpc.request(method, params, {timeoutMs:30000}));
    reads.set(key, pending);
    const clear = () => { if (reads.get(key) === pending) reads.delete(key); };
    pending.then(clear, clear);
  }
  const outcome = await pending.then(value=>({ok:true,value}),error=>({ok:false,error}));
  manager.requireConnected();
  if (manager.rpc !== rpc || manager.generation !== generation) {
    throw Object.assign(new Error('连接已变化，请重新读取状态。'), {status:409, code:'CONNECTION_CHANGED'});
  }
  if (method.startsWith('account/') && (manager.accountRevision || 0) !== accountRevision) {
    throw Object.assign(new Error('账号已变化，请重新读取状态。'), {status:409, code:'ACCOUNT_CHANGED'});
  }
  if(!outcome.ok)throw outcome.error;
  return outcome.value;
}
