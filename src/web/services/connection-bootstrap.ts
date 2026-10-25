export interface ConnectionConfig {
 machineId:string;
 data:{id:string;host:{alias:string;machineId:string;home:string;user:string;[field:string]:unknown};[field:string]:unknown}[];
 defaultConnection:string;
 [field:string]:unknown;
}
interface Dependencies {
 storage:()=>Pick<Storage,'getItem'>;
 reload:()=>void;
 fetch:typeof globalThis.fetch;
 setTimeout:typeof globalThis.setTimeout;
 clearTimeout:typeof globalThis.clearTimeout;
}
/** Startup reads precede API/CSRF initialization; retain their separate contract. */
export function createConnectionBootstrap({storage,reload,fetch,setTimeout,clearTimeout}:Dependencies){
 function savedHost(){try{return storage().getItem('rcm.connection');}catch{return null;}}
 async function readConnections():Promise<ConnectionConfig>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
   const response=await fetch('/api/connections',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.status===401){reload();throw new Error('登录已失效，请重新配对。');}
   if(!response.ok)throw new Error('无法读取连接配置。');
   return await response.json();
  } finally {clearTimeout(timer);}
 }
 function selectTarget(ids:ReadonlyArray<string|null>,requestedHost:string|null,defaultConnection:string){
  return ids.includes(requestedHost)?requestedHost:ids.includes(savedHost())?savedHost():defaultConnection;
 }
 return {readConnections,selectTarget};
}
