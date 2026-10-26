// Local recovery snapshots are isolated by machine and thread. They never grant
// control or replace a newer network response. Failure only disables the cache.
let database;
const epochKey='rcm.recovery.epoch';
function currentEpoch(){try{return localStorage.getItem(epochKey)||'initial';}catch{return 'initial';}}
const pageEpoch=currentEpoch();
function open() {
  return database ||= new Promise((resolve,reject)=>{
    const r=indexedDB.open('rcm.recovery.v2',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('details',{keyPath:'key'}).createIndex('updated','updated');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export const cacheKey=(host,id)=>JSON.stringify([host,id]);
export function recoveryDetail(detail) {
  return {...detail,controlled:false,controlState:'viewing',pendingRequests:[],queue:null,backgroundTerminals:null,goal:null,recovering:true};
}
export async function readDetailCache(host,id) {
  try {
    const db=await open();
    return await new Promise(resolve=>{
      const r=db.transaction('details').objectStore('details').get(cacheKey(host,id));
      r.onsuccess=()=>resolve(r.result?.epoch===pageEpoch&&pageEpoch===currentEpoch()&&r.result?.detail ? recoveryDetail(r.result.detail) : null);r.onerror=()=>resolve(null);
    });
  } catch { return null; }
}
export async function writeDetailCache(host,id,detail) {
  if(pageEpoch!==currentEpoch() || !detail || detail.recovering || detail.outputPreview || detail.thread?.id!==id)return;
  try {
    const db=await open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('details','readwrite'),store=tx.objectStore('details');
      store.put({key:cacheKey(host,id),epoch:pageEpoch,updated:Date.now(),detail});
      // Keep only four recent conversations. Do not read all large values to evict.
      const rows=[];const cursor=store.index('updated').openKeyCursor();
      cursor.onsuccess=()=>{const c=cursor.result;if(c){rows.push({key:c.primaryKey,updated:c.key});c.continue();}else for(const row of rows.sort((a,b)=>b.updated-a.updated).slice(4))store.delete(row.key);};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  } catch { /* Private browsing, quota or storage errors must not block output. */ }
}

// A delta is applied only to the exact snapshot sent with the request. Offsets
// and hashes are generated on the host, so Unicode cannot split at the boundary.
export function outputBases(turns) {
  return new Map(turns.flatMap(t=>t.items||[]).filter(i=>i.outputToken&&typeof i.aggregatedOutput==='string').map(i=>[i.id,{token:i.outputToken,text:i.aggregatedOutput}]));
}
export function hydrateOutputs(data,bases) {
  for(const turn of data.turns||[])for(const item of turn.items||[]){
    if(item.outputBaseToken){
      const base=bases.get(item.id);
      if(!base||base.token!==item.outputBaseToken)throw new Error('输出快照已变化，正在重新读取。');
      item.aggregatedOutput=base.text+(item.outputDelta||'');
      delete item.outputBaseToken;delete item.outputDelta;
    }
  }
  return data;
}

export async function clearDetailCache(){
  try{localStorage.setItem(epochKey,crypto.randomUUID());}catch{}
  const db=await open();
  await new Promise((resolve,reject)=>{const tx=db.transaction('details','readwrite');tx.objectStore('details').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}

// Decompress individual outputs outside JSON parsing. The wire document stays
// small; full text is restored before exact-base hydration or rendering.
export async function decodeOutputs(data){
  for(const turn of data.turns||[])for(const item of turn.items||[]){
    const packed=item.outputCompressed;
    if(!packed)continue;
    if(!['aggregatedOutput','outputDelta'].includes(packed.field))throw new Error('日志编码字段无效。');
    const bytes=Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));
    item[packed.field]=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    delete item.outputCompressed;
  }
  return data;
}

export async function exportDetailCache(){
 const db=await open();
 return new Promise((resolve,reject)=>{const tx=db.transaction('details'),r=tx.objectStore('details').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function exportDetailCacheKeys(){
 const db=await open();
 return new Promise((resolve,reject)=>{const tx=db.transaction('details'),r=tx.objectStore('details').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function importDetailCache(rows,hosts){
 for(const row of rows){const key=JSON.parse(row.key);if(!Array.isArray(key)||key.length!==2||!hosts.includes(key[0])||typeof key[1]!=='string'||row.detail?.thread?.id!==key[1])throw Error('详情缓存的连接或会话标识无效。');}
 const db=await open();
 await new Promise((resolve,reject)=>{const tx=db.transaction('details','readwrite'),store=tx.objectStore('details');for(const row of rows)store.put({...row,epoch:currentEpoch(),detail:recoveryDetail(row.detail)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
