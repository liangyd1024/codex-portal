import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {setConnectionSavePending} from './ConnectionManager';
import type {ConnectionManagerOptions} from './ConnectionManager';
import {confirmAction} from '../../../public/feedback.js';
interface Host {id:string;kind:'local'|'ssh';alias:string;address:string;port?:number;user:string;home:string;binary:string;hasIdentityFile?:boolean}
interface Config {revision:string;defaultConnection:string;connections:Host[]}
const empty={alias:'',address:'',port:'',user:'',binary:'',identityFile:''};
export function ConnectionEditor({api,flush,closed,initialConnection}:ConnectionManagerOptions&{closed:()=>void;initialConnection:string}){
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
 const [config,setConfig]=useState<Config|null>(null),[fields,setFields]=useState(empty),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[refreshNeeded,setRefreshNeeded]=useState(false);
 const selected=initialConnection,adding=!selected,draftKey='rcm.connection-editor.'+(selected||'new');
 const current=config?.connections.find(host=>host.id===selected);
 useLayoutEffect(()=>{dialog.current!.showModal();return()=>{generation.current++;dialog.current?.close();};},[]);
 async function load(){
  const serial=++generation.current;setBusy(true);setFailed(false);setRefreshNeeded(false);setMessage('');
  try{
   const result=await api<Config>('/api/connection-config');if(serial!==generation.current)return;
   if(selected&&!result.connections.some(host=>host.id===selected))throw Error('此连接已被移除，请关闭后重新选择机器。');
   setConfig(result);
   if(!config){
    const host=result.connections.find(item=>item.id===selected);
    setFields(host?{...empty,alias:host.alias,binary:host.binary}:empty);
    try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||sessionStorage.getItem('rcm.connection-editor')||'null');if(saved?.selected===selected)setFields({...empty,...saved.fields,port:String(saved.fields.port||'')});}catch{setMessage('草稿无法读取，请重新填写。');}
   }
  }catch(e){if(serial===generation.current){setMessage((e as Error).message);setFailed(true);setRefreshNeeded(true);}}
  finally{if(serial===generation.current)setBusy(false);}
 }
 useEffect(()=>{void load();},[]);
 function change(patch:Partial<typeof empty>){
  const next={...fields,...patch};setFields(next);
  try{sessionStorage.setItem(draftKey,JSON.stringify({selected,fields:next}));}catch{setMessage('草稿无法保存，请保留当前页面。');setFailed(true);}
 }
 async function save(action:string){
  if(!config||busy)return;
  if(action==='remove'&&!await confirmAction('移除这里的连接配置。目标机器上的会话和任务会继续运行。',{title:'移除连接',accept:'移除'}))return;
  const serial=++generation.current;setConnectionSavePending(true);setBusy(true);setFailed(false);setRefreshNeeded(false);setMessage(adding?'正在连接并识别环境…':'正在保存…');
  try{
   flush();
   let connection:Record<string,unknown>={alias:fields.alias,binary:fields.binary,...current?.kind==='ssh'?{identityFile:fields.identityFile}:{}};
   if(action==='add'){
    const discovered=await api<{connection:Record<string,unknown>}>('/api/connection-discover',{method:'POST',body:{connection:{address:fields.address,user:fields.user,port:fields.port,binary:fields.binary,identityFile:fields.identityFile}}});
    connection=discovered.connection;setMessage('已识别机器，正在添加…');
   }else if(action==='edit'&&current&&(fields.binary!==current.binary||fields.identityFile)){
    await api('/api/connection-probe',{method:'POST',body:{id:selected,connection}});
   }
   await api('/api/connection-config',{method:'POST',body:{revision:config.revision,action,id:selected,connection}});
   sessionStorage.removeItem(draftKey);setMessage('已保存，正在刷新连接。');
  }catch(e){if(serial===generation.current){setMessage((e as Error).message);setFailed(true);setRefreshNeeded(/^CONFIG_/.test(String((e as {code?:string}).code||'')));}}
  finally{if(serial===generation.current)setBusy(false);setConnectionSavePending(false);}
 }
 return createPortal(<dialog className="sidebar-dialog connection-editor" ref={dialog} aria-labelledby="connection-editor-title" onCancel={event=>{if(busy)event.preventDefault();else closed();}} onClose={closed}>
  <form onSubmit={event=>{event.preventDefault();void save(adding?'add':'edit');}} onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault();}}>
   <h2 id="connection-editor-title">{adding?'添加机器':'管理连接'}</h2>
   {adding?<>
    <label>机器地址<input autoComplete="off" required autoFocus placeholder="Tailscale 名称、IP 或 SSH 别名" value={fields.address} disabled={busy} onChange={e=>change({address:e.target.value})}/></label>
    <label>用户名<input autoComplete="off" placeholder="留空使用已有 SSH 配置" value={fields.user} disabled={busy} onChange={e=>change({user:e.target.value})}/></label>
    <p className="subtle">连接后自动识别机器名称和 Codex。</p>
   </>:<>
    <label>名称<input required autoFocus maxLength={80} value={fields.alias} disabled={busy||!config} onChange={e=>change({alias:e.target.value})}/></label>
    {current&&<p className="subtle">{current.kind==='local'?'本机':`${current.user}@${current.address}`}{config?.defaultConnection===selected?' · 默认连接':''}</p>}
   </>}
   <details className="connection-editor-advanced"><summary>高级设置</summary><div className="connection-editor-fields">
    {adding&&<label>SSH 端口<input type="number" min={1} max={65535} placeholder="自动（通常为 22）" value={fields.port} disabled={busy} onChange={e=>change({port:e.target.value})}/></label>}
    <label>Codex 路径<input required={!adding} placeholder="自动查找" value={fields.binary} disabled={busy} onChange={e=>change({binary:e.target.value})}/></label>
    {(adding||current?.kind==='ssh')&&<><label>SSH 私钥路径<input placeholder={current?.hasIdentityFile?'留空保留现有私钥':'使用已有 SSH 配置或默认密钥'} value={fields.identityFile} disabled={busy} onChange={e=>change({identityFile:e.target.value})}/></label><p className="subtle">路径位于运行网页服务的机器上。</p></>}
   </div></details>
   {!adding&&(config?.defaultConnection!==selected||current?.kind==='ssh')&&<details className="connection-editor-advanced"><summary>更多操作</summary><div className="connection-editor-fields">
    {config?.defaultConnection!==selected&&<button type="button" className="secondary-button" disabled={busy||!config} onClick={()=>void save('default')}>设为默认</button>}
    {current?.kind==='ssh'&&<button type="button" className="text-button release-button" disabled={busy} onClick={()=>void save('remove')}>移除连接</button>}
   </div></details>}
   {message&&<p role={failed?'alert':'status'} aria-live="polite" className="subtle">{message}</p>}
   {refreshNeeded&&<button type="button" className="text-button" disabled={busy} onClick={()=>void load()}>重新读取配置</button>}
   <div className="sidebar-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={closed}>取消</button><button type="submit" className="primary-button" disabled={busy||!config}>{busy?'处理中…':adding?'连接并添加':'保存'}</button></div>
  </form>
 </dialog>,document.body);
}
