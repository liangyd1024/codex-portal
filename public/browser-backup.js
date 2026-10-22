import {confirmAction} from './feedback.js';
import {exportDetailCache,importDetailCache} from './detail-cache.js';
const storageKeys=s=>Object.keys(s).filter(k=>k.startsWith('rcm.')).sort();
const snapshot=s=>Object.fromEntries(storageKeys(s).map(k=>[k,s.getItem(k)]));
const targets=c=>c.data.map(({id,host:h})=>({id,machineId:h.machineId,home:h.home,user:h.user})).sort((a,b)=>a.id.localeCompare(b.id));
export async function exportBrowser(config){
 let details=[],cacheError=null;
 try{details=await exportDetailCache();}catch(e){cacheError=e.message;}
 let legacy=[];try{legacy=(await indexedDB.databases()).map(d=>d.name).filter(n=>n.startsWith('rcm.')&&n!=='rcm.recovery.v2');}catch{}
 return {format:'rcm-browser',version:1,capturedAt:new Date().toISOString(),machineId:config.machineId,connections:targets(config),localStorage:snapshot(localStorage),sessionStorage:snapshot(sessionStorage),cache:{database:'rcm.recovery.v2',rows:details},coverage:{currentOrigin:location.origin,currentBrowser:true,currentTab:true,otherBrowsers:false,otherTabs:false,cookies:false,legacyDatabasesNotIncluded:legacy,cacheError}};
}
export function validateBrowser(data,config){
 if(data?.format!=='rcm-browser'||data.version!==1)throw Error('浏览器备份版本不兼容。');
 if(data.machineId!==config.machineId||JSON.stringify(data.connections)!==JSON.stringify(targets(config)))throw Error('备份机器或连接目标不一致，已拒绝导入。');
 for(const values of [data.localStorage,data.sessionStorage]){if(!values||typeof values!=='object'||Array.isArray(values))throw Error('浏览器存储格式无效。');for(const [key,value] of Object.entries(values))if(!key.startsWith('rcm.')||typeof value!=='string')throw Error('包含本应用范围外的数据。');}
 if(data.cache?.database!=='rcm.recovery.v2'||!Array.isArray(data.cache.rows))throw Error('详情缓存版本不兼容。');
 for(const row of data.cache.rows){const key=JSON.parse(row.key);if(!Array.isArray(key)||key.length!==2||!config.data.some(c=>c.id===key[0])||typeof key[1]!=='string'||row.detail?.thread?.id!==key[1])throw Error('详情缓存目标无效。');}
 return data;
}
export async function importBrowser(data,config){
 validateBrowser(data,config);
 const before=[snapshot(localStorage),snapshot(sessionStorage)];
 try{
  for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const [key,value] of Object.entries(values))s.setItem(key,value);}
  await importDetailCache(data.cache.rows,config.data.map(c=>c.id));
 }catch(error){for(const [i,values] of [data.localStorage,data.sessionStorage].entries()){const s=i?sessionStorage:localStorage;for(const key of Object.keys(values))if(key in before[i])s.setItem(key,before[i][key]);else s.removeItem(key);}throw error;}
}
export function installBrowserBackup(config,flush,imported=()=>{}){
 const area=document.getElementById('browser-backup-body');
 const scope=document.createElement('details');scope.className='settings-help';const title=document.createElement('summary');title.textContent='备份范围';const explanation=document.createElement('p');explanation.textContent='导出当前浏览器的本应用设置、当前标签页状态和详情缓存。其他浏览器和标签页需要分别导出；不包含 Cookie。';
 scope.append(title,explanation);
 const status=document.createElement('p');status.className='subtle';status.setAttribute('role','status');
 const download=document.createElement('button');download.className='secondary-button';download.textContent='导出浏览器数据';
 const upload=document.createElement('input');upload.type='file';upload.accept='application/json';upload.hidden=true;
 const load=document.createElement('button');load.className='text-button';load.textContent='导入浏览器数据';load.onclick=()=>upload.click();
 download.onclick=async()=>{download.disabled=true;try{flush();const data=await exportBrowser(config);const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`browser-export-${config.machineId}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=`已导出：${data.capturedAt}。仅包含当前浏览器、当前标签页。${data.coverage.cacheError?'缓存读取失败：'+data.coverage.cacheError:''} 导出文件含草稿和缓存内容，请交给 backup --browser 加密保存。`;}catch(e){status.textContent=e.message;}finally{download.disabled=false;}};
 let importing=false;
 upload.onchange=async()=>{if(importing)return;try{const f=upload.files[0];if(!f)return;if(f.size>256*1024*1024)throw Error('浏览器备份超过 256 MiB。');const data=validateBrowser(JSON.parse(await f.text()),config);if(!await confirmAction('连接目标已核对。将合并此备份中的应用设置、草稿和缓存，然后刷新页面。',{title:'导入浏览器数据',accept:'确认导入'}))return;importing=true;load.disabled=download.disabled=true;load.textContent='正在导入…';flush();await importBrowser(data,config);imported();location.reload();}catch(e){status.textContent=e.message;}finally{importing=false;load.disabled=download.disabled=false;load.textContent='导入浏览器数据';upload.value='';}};
 const actions=document.createElement('div');actions.className='settings-actions';actions.append(download,load);area.append(actions,status,scope,upload);
}
