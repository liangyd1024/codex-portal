export interface ApiOptions {
 method?: string;
 headers?: Record<string,string>;
 body?: unknown;
 timeout?: number;
}
interface ActivityRecord { activity?: { observedAt?: number; [key:string]:unknown }; [key:string]:unknown }
interface WireEnvelope {
 [key:string]:unknown;
 token?: string;
 thread?: ActivityRecord;
 data?: ActivityRecord[];
 error?: {message?:string;code?:string;details?:unknown};
 message?:string;
}
export interface ApiError extends Error { readOnly?:boolean;status?:number;code?:string;details?:unknown }
export interface ApiDependencies {
 targetUrl:(path:string)=>string;
 csrf:{get:()=>string;set:(token:string)=>void};
 flushDrafts:()=>void;
 reload:()=>void;
 fetch?:typeof globalThis.fetch;
}
// Preserve wire payloads and browser-clock freshness; share only in-flight CSRF reads.
export function createApiClient({targetUrl,csrf,flushDrafts,reload,fetch=(...args:Parameters<typeof globalThis.fetch>)=>globalThis.fetch(...args)}:ApiDependencies) {
const csrfReads=new Map<string,Promise<WireEnvelope>>();
function api<T=WireEnvelope>(path:string,options:ApiOptions={}):Promise<T>{
  // Only identical default token reads can join. Explicit transport options
  // (headers or timeout) retain their own request and failure semantics.
  if(path!=='/api/csrf'||Object.keys(options).length)return request<T>(path,options);
  const scope=targetUrl(path);
  let pending=csrfReads.get(scope);
  if(!pending){pending=request<WireEnvelope>(path,options).finally(()=>{csrfReads.delete(scope);});csrfReads.set(scope,pending);}
  return pending as Promise<T>;
}
async function request<T=WireEnvelope>(path:string, options:ApiOptions = {}):Promise<T> {
  path=targetUrl(path);
  const method = options.method || 'GET';
  const headers:Record<string,string> = {Accept:'application/json',...options.headers};
  if (method !== 'GET') {
    if (!csrf.get()) { const c=await api<{token:string}>('/api/csrf'); csrf.set(c.token); }
    headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf.get();
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeout || 90000);
  let response;
  try {
    response = await fetch(path, {method, credentials:'same-origin', headers, signal:controller.signal, ...(method !== 'GET' ? {body:JSON.stringify(options.body || {})} : {})});
    const raw = await response.text();
    let data:WireEnvelope;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('服务未返回有效数据。请查看连接诊断。'); }
    if (!response.ok) {
      if(response.status===401&&data.error?.code==='PAIRING_REQUIRED'){flushDrafts();reload();}
      const e:ApiError = new Error(data.error?.message || data.message || '请求失败，HTTP ' + response.status);
      e.readOnly = method==='GET'; e.status = response.status; e.code = data.error?.code; e.details = data.error?.details; throw e;
    }
    // Freshness uses this browser's clock, including observations from SSH hosts.
    for(const thread of [data.thread,...(Array.isArray(data.data)?data.data:[])]) {
      if(thread?.activity)thread.activity.observedAt=Date.now();
    }
    return data as T;
  } catch (e) {
    if ((e as {name:string}).name === 'AbortError') throw new Error(method==='GET'?'读取超时，已有内容和草稿保留，请重试刷新。':'操作结果未确认，草稿已保留。请先核对会话记录，避免重复提交。');
    if (e instanceof TypeError) throw new Error('无法连接本机服务。请确认服务仍在运行。');
    throw e;
  } finally { clearTimeout(timer); }
}
 return api;
}
