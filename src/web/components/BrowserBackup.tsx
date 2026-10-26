import {useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {confirmAction} from '../../../public/feedback.js';
import {exportBrowser,validateBrowser,inspectBrowser,previewBrowser,importBrowser} from '../../../public/browser-backup.js';
interface Config {machineId:string;data:Array<{id:string;host:{machineId:string;home:string;user:string}}>}
interface Installed {config:Config;flush:()=>void;imported:()=>void}
const store=createStore<{installed:Installed|null}>(()=>({installed:null}));
export function installBrowserBackup(config:Config,flush:()=>void,imported=()=>{}){
 flushSync(()=>store.setState({installed:{config,flush,imported}}));
}
function Panel({config,flush,imported}:Installed){
 const input=useRef<HTMLInputElement>(null),importing=useRef(false);
 const [pending,setPending]=useState<{data:unknown;matches:Array<{id:string;compatible:boolean}>;full:boolean}|null>(null);
 const [selected,setSelected]=useState<string[]>([]);
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
  importing.current=true;update({loadDisabled:true,downloadDisabled:true});
  try{
   const file=input.current?.files?.[0];if(!file)return;
   if(file.size>256*1024*1024)throw Error('浏览器备份超过 256 MiB。');
   const data=JSON.parse(await file.text()),matches=inspectBrowser(data,config);
   let full=false;try{validateBrowser(data,config);full=true;}catch{}
   setPending({data,matches,full});setSelected([]);update({status:'选择要导入的连接。未选连接和全局设置保持不变。'});
  }catch(error){update({status:(error as Error).message});}
  finally{importing.current=false;update({loadDisabled:false,downloadDisabled:false});if(input.current)input.current.value='';}
 };
 const apply=async(full=false)=>{
  if(importing.current||!pending||(!full&&!selected.length))return;
  importing.current=true;update({loadDisabled:true,downloadDisabled:true,loadLabel:'正在导入…'});
  try{
   flush();const preview=await previewBrowser(pending.data,config,full?undefined:selected);
   if(!await confirmAction(`${full?'整份导入（含全局设置）':'按所选连接导入'}： ${preview.storageItems} 项状态和 ${preview.cacheItems} 项缓存。其中 ${preview.overwritten} 项状态、${preview.cacheOverwritten} 项缓存会覆盖现有内容。导入后刷新页面。`,{title:'确认导入范围',accept:'确认导入'}))return;
   await importBrowser(pending.data,config,full?undefined:selected);imported();location.reload();
  }catch(error){update({status:(error as Error).message});}
  finally{importing.current=false;update({loadDisabled:false,downloadDisabled:false,loadLabel:'导入浏览器数据'});}
 };
 return <><div className="settings-actions"><button className="secondary-button" disabled={view.downloadDisabled} onClick={()=>void download()}>导出浏览器数据</button><button className="text-button" disabled={view.loadDisabled} onClick={()=>input.current?.click()}>{view.loadLabel}</button></div><p className="subtle" role="status">{view.status}</p>{pending&&<fieldset className="backup-selection" disabled={view.loadDisabled}><legend>选择导入的连接</legend>{pending.matches.map(match=><label key={match.id}><input type="checkbox" disabled={!match.compatible} checked={selected.includes(match.id)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,match.id]:previous.filter(id=>id!==match.id))}/><span>{config.data.find(item=>item.id===match.id)?.host.user||match.id}{match.compatible?'':'（身份不匹配）'} · {match.id}</span></label>)}<div className="settings-actions"><button className="secondary-button" disabled={!selected.length||view.loadDisabled} onClick={()=>void apply()}>预览并导入</button>{pending.full&&<button className="text-button" onClick={()=>void apply(true)}>整份导入（含全局设置）</button>}<button className="text-button" onClick={()=>{setPending(null);setSelected([]);update({status:''});}}>取消</button></div></fieldset>}<p className="subtle">导出文件含草稿和缓存内容。下载后，请按 README 的加密备份步骤保存；下载本身不包含加密。</p><details className="settings-help"><summary>备份范围</summary><p>导出当前浏览器的本应用设置、当前标签页状态和详情缓存。其他浏览器和标签页需要分别导出；不包含 Cookie。</p></details><input ref={input} type="file" accept="application/json" hidden onChange={()=>void upload()}/></>;
}
export function BrowserBackupView(){
 const installed=useStore(store,state=>state.installed);
 return installed?<Panel {...installed}/>:null;
}
