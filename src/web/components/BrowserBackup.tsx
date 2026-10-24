import {useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {confirmAction} from '../../../public/feedback.js';
import {exportBrowser,validateBrowser,importBrowser} from '../../../public/browser-backup.js';
interface Config {machineId:string;data:Array<{id:string;host:{machineId:string;home:string;user:string}}>}
interface Installed {config:Config;flush:()=>void;imported:()=>void}
const store=createStore<{installed:Installed|null}>(()=>({installed:null}));
export function installBrowserBackup(config:Config,flush:()=>void,imported=()=>{}){
 flushSync(()=>store.setState({installed:{config,flush,imported}}));
}
function Panel({config,flush,imported}:Installed){
 const input=useRef<HTMLInputElement>(null),importing=useRef(false);
 const [view,setView]=useState({downloadDisabled:false,loadDisabled:false,loadLabel:'导入浏览器数据',status:''});
 const update=(patch:Partial<typeof view>)=>flushSync(()=>setView(previous=>({...previous,...patch})));
 const download=async()=>{
  update({downloadDisabled:true,status:'正在导出…'});
  try{
   flush();const data=await exportBrowser(config);
   const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download=`browser-export-${config.machineId}-${Date.now()}.json`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);update({status:data.coverage.cacheError?'缓存读取失败：'+data.coverage.cacheError:''});
  }catch(error){update({status:(error as Error).message});}
  finally{update({downloadDisabled:false});}
 };
 const upload=async()=>{
  if(importing.current)return;
  try{
   const file=input.current?.files?.[0];if(!file)return;
   if(file.size>256*1024*1024)throw Error('浏览器备份超过 256 MiB。');
   const data=validateBrowser(JSON.parse(await file.text()),config);
   if(!await confirmAction('连接目标已核对。将合并此备份中的应用设置、草稿和缓存，然后刷新页面。',{title:'导入浏览器数据',accept:'确认导入'}))return;
   importing.current=true;update({loadDisabled:true,downloadDisabled:true,loadLabel:'正在导入…'});
   flush();await importBrowser(data,config);imported();location.reload();
  }catch(error){update({status:(error as Error).message});}
  finally{importing.current=false;update({loadDisabled:false,downloadDisabled:false,loadLabel:'导入浏览器数据'});if(input.current)input.current.value='';}
 };
 return <><div className="settings-actions"><button className="secondary-button" disabled={view.downloadDisabled} onClick={()=>void download()}>导出浏览器数据</button><button className="text-button" disabled={view.loadDisabled} onClick={()=>input.current?.click()}>{view.loadLabel}</button></div><p className="subtle" role="status">{view.status}</p><p className="subtle">导出文件含草稿和缓存内容。下载后，请按 README 的加密备份步骤保存；下载本身不包含加密。</p><details className="settings-help"><summary>备份范围</summary><p>导出当前浏览器的本应用设置、当前标签页状态和详情缓存。其他浏览器和标签页需要分别导出；不包含 Cookie。</p></details><input ref={input} type="file" accept="application/json" hidden onChange={()=>void upload()}/></>;
}
export function BrowserBackupView(){
 const installed=useStore(store,state=>state.installed);
 return installed?<Panel {...installed}/>:null;
}
