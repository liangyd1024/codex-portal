interface Config {machineId:string;data:Array<{id:string;host:{machineId:string;home:string;user:string}}>}
interface CacheRow {key:string;detail?:{thread?:{id?:string}};[field:string]:unknown}
export interface Backup {format:string;version:number;machineId:string;connections:unknown;localStorage:Record<string,string>;sessionStorage:Record<string,string>;cache:{database:string;rows:CacheRow[]}}
import {exportDetailCache,exportDetailCacheKeys,importDetailCache} from '../../../public/detail-cache.js';
const storageKeys=(s:Storage)=>Object.keys(s).filter(k=>k.startsWith('rcm.')).sort();
const snapshot=(s:Storage)=>Object.fromEntries(storageKeys(s).map(k=>[k,s.getItem(k)]));
const targets=(c:Config)=>c.data.map(({id,host:h})=>({id,machineId:h.machineId,home:h.home,user:h.user})).sort((a,b)=>a.id.localeCompare(b.id));
export async function exportBrowser(config:Config){
 let details:unknown=[],cacheError:string|null=null;
 try{details=await exportDetailCache();}catch(e){cacheError=(e as Error).message;}
 let legacy:string[]=[];try{legacy=(await indexedDB.databases()).map(d=>d.name).filter((n):n is string=>n!.startsWith('rcm.')&&n!=='rcm.recovery.v2');}catch{}
 return {format:'rcm-browser',version:1,capturedAt:new Date().toISOString(),machineId:config.machineId,connections:targets(config),localStorage:snapshot(localStorage),sessionStorage:snapshot(sessionStorage),cache:{database:'rcm.recovery.v2',rows:details},coverage:{currentOrigin:location.origin,currentBrowser:true,currentTab:true,otherBrowsers:false,otherTabs:false,cookies:false,legacyDatabasesNotIncluded:legacy,cacheError}};
}
function validateFormat(value:unknown):Backup{
 const data=value as Backup;
 if(data?.format!=='rcm-browser'||data.version!==1)throw Error('浏览器备份版本不兼容。');
 if(!Array.isArray(data.connections)||data.connections.some(c=>!c||typeof c.id!=='string'||typeof c.machineId!=='string'||typeof c.home!=='string'||typeof c.user!=='string')||new Set(data.connections.map(c=>c.id)).size!==data.connections.length)throw Error('备份连接格式无效。');
 for(const values of [data.localStorage,data.sessionStorage]){if(!values||typeof values!=='object'||Array.isArray(values))throw Error('浏览器存储格式无效。');for(const [key,value] of Object.entries(values))if(!key.startsWith('rcm.')||typeof value!=='string')throw Error('包含本应用范围外的数据。');}
 if(data.cache?.database!=='rcm.recovery.v2'||!Array.isArray(data.cache.rows))throw Error('详情缓存版本不兼容。');
 for(const row of data.cache.rows){const key=JSON.parse(row.key);if(!Array.isArray(key)||key.length!==2||!(data.connections as Array<{id:string}>).some(c=>c.id===key[0])||typeof key[1]!=='string'||row.detail?.thread?.id!==key[1])throw Error('详情缓存目标无效。');}
 return data;
}
export function validateBrowser(value:unknown,config:Config):Backup{
 const data=validateFormat(value);
 if(data.machineId!==config.machineId||JSON.stringify(data.connections)!==JSON.stringify(targets(config)))throw Error('备份机器或连接目标不一致，已拒绝导入。');
 return data;
}
export function inspectBrowser(value:unknown,config:Config){
 const data=validateFormat(value);
 if(data.machineId!==config.machineId)throw Error('备份来源机器不一致，已拒绝导入。');
 const source=data.connections as ReturnType<typeof targets>,currentTargets=new Map(targets(config).map(host=>[host.id,host]));
 return source.map(host=>{const current=currentTargets.get(host.id);return {id:host.id,compatible:!!current&&current.machineId===host.machineId&&current.home===host.home&&current.user===host.user};});
}
// Only documented per-connection keys can cross a partial import boundary.
// In-flight sends, project request tokens, retry timers and global state stay put.
const connectionKeys=['view','new-chat','outputPositions','openDetails','drafts','annotations','composer','images','taskNotifications','autoRefresh','planCompletion'];
export function selectBrowser(value:unknown,config:Config,ids:string[]):Backup{
 const matches=inspectBrowser(value,config);
 if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!matches.some(match=>match.id===id&&match.compatible)))throw Error('请选择身份匹配的连接。');
 const data=value as Backup;
 const selected=new Set(ids);
 const filter=(values:Record<string,string>)=>Object.fromEntries(Object.entries(values).filter(([key])=>ids.some(id=>connectionKeys.some(prefix=>key==='rcm.'+prefix+'.'+id)||key.startsWith('rcm.sidebar.expanded.'+id+'.'))));
 return {...data,connections:targets(config),localStorage:filter(data.localStorage),sessionStorage:filter(data.sessionStorage),cache:{...data.cache,rows:data.cache.rows.filter(row=>selected.has(JSON.parse(row.key)[0]))}};
}
export async function previewBrowser(value:unknown,config:Config,ids?:string[]){
 const data=ids?selectBrowser(value,config,ids):validateBrowser(value,config);
 const values=[data.localStorage,data.sessionStorage];
 const storageItems=values.reduce((count,items)=>count+Object.keys(items).length,0);
 const overwritten=values.reduce((count,items,index)=>count+Object.entries(items).filter(([key,value])=>{const current=(index?sessionStorage:localStorage).getItem(key);return current!==null&&current!==value;}).length,0);
 const existing=new Set(await exportDetailCacheKeys());
 return {storageItems,overwritten,cacheItems:data.cache.rows.length,cacheOverwritten:data.cache.rows.filter(row=>existing.has(row.key)).length};
}
export async function importBrowser(value:unknown,config:Config,ids?:string[]){
 const data=ids?selectBrowser(value,config,ids):validateBrowser(value,config);
 const before=[snapshot(localStorage),snapshot(sessionStorage)];
 try{
  for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const [key,value] of Object.entries(values))s.setItem(key,value);}
  await importDetailCache(data.cache.rows,config.data.map(c=>c.id));
 }catch(error){for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const key of Object.keys(values))if(key in before[i])s.setItem(key,before[i][key] as string);else s.removeItem(key);}throw error;}
}
