interface Config {machineId:string;data:Array<{id:string;host:{machineId:string;home:string;user:string}}>}
interface CacheRow {key:string;detail?:{thread?:{id?:string}};[field:string]:unknown}
interface Backup {format:string;version:number;machineId:string;connections:unknown;localStorage:Record<string,string>;sessionStorage:Record<string,string>;cache:{database:string;rows:CacheRow[]}}
import {exportDetailCache,importDetailCache} from '../../../public/detail-cache.js';
const storageKeys=(s:Storage)=>Object.keys(s).filter(k=>k.startsWith('rcm.')).sort();
const snapshot=(s:Storage)=>Object.fromEntries(storageKeys(s).map(k=>[k,s.getItem(k)]));
const targets=(c:Config)=>c.data.map(({id,host:h})=>({id,machineId:h.machineId,home:h.home,user:h.user})).sort((a,b)=>a.id.localeCompare(b.id));
export async function exportBrowser(config:Config){
 let details:unknown=[],cacheError:string|null=null;
 try{details=await exportDetailCache();}catch(e){cacheError=(e as Error).message;}
 let legacy:string[]=[];try{legacy=(await indexedDB.databases()).map(d=>d.name).filter((n):n is string=>n!.startsWith('rcm.')&&n!=='rcm.recovery.v2');}catch{}
 return {format:'rcm-browser',version:1,capturedAt:new Date().toISOString(),machineId:config.machineId,connections:targets(config),localStorage:snapshot(localStorage),sessionStorage:snapshot(sessionStorage),cache:{database:'rcm.recovery.v2',rows:details},coverage:{currentOrigin:location.origin,currentBrowser:true,currentTab:true,otherBrowsers:false,otherTabs:false,cookies:false,legacyDatabasesNotIncluded:legacy,cacheError}};
}
export function validateBrowser(value:unknown,config:Config):Backup{
 const data=value as Backup;
 if(data?.format!=='rcm-browser'||data.version!==1)throw Error('浏览器备份版本不兼容。');
 if(data.machineId!==config.machineId||JSON.stringify(data.connections)!==JSON.stringify(targets(config)))throw Error('备份机器或连接目标不一致，已拒绝导入。');
 for(const values of [data.localStorage,data.sessionStorage]){if(!values||typeof values!=='object'||Array.isArray(values))throw Error('浏览器存储格式无效。');for(const [key,value] of Object.entries(values))if(!key.startsWith('rcm.')||typeof value!=='string')throw Error('包含本应用范围外的数据。');}
 if(data.cache?.database!=='rcm.recovery.v2'||!Array.isArray(data.cache.rows))throw Error('详情缓存版本不兼容。');
 for(const row of data.cache.rows){const key=JSON.parse(row.key);if(!Array.isArray(key)||key.length!==2||!config.data.some(c=>c.id===key[0])||typeof key[1]!=='string'||row.detail?.thread?.id!==key[1])throw Error('详情缓存目标无效。');}
 return data;
}
export async function importBrowser(value:unknown,config:Config){
 const data=value as Backup;
 validateBrowser(data,config);
 const before=[snapshot(localStorage),snapshot(sessionStorage)];
 try{
  for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const [key,value] of Object.entries(values))s.setItem(key,value);}
  await importDetailCache(data.cache.rows,config.data.map(c=>c.id));
 }catch(error){for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const key of Object.keys(values))if(key in before[i])s.setItem(key,before[i][key] as string);else s.removeItem(key);}throw error;}
}
