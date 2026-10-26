import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {setConnectionSavePending} from './ConnectionManager';
import type {ConnectionManagerOptions} from './ConnectionManager';
import {confirmAction} from '../../../public/feedback.js';
interface Host {id:string;kind:'local'|'ssh';alias:string;address:string;port?:number;user:string;home:string;binary:string;hasIdentityFile?:boolean}
interface Config {revision:string;defaultConnection:string;connections:Host[]}
const empty={alias:'',address:'',port:22,user:'',home:'',binary:'',identityFile:''};
const draftKey='rcm.connection-editor';
export function ConnectionEditor({api,flush,closed}:ConnectionManagerOptions&{closed:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [config,setConfig]=useState<Config|null>(null),[selected,setSelected]=useState(''),[fields,setFields]=useState(empty),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0);
 useLayoutEffect(()=>{dialog.current!.showModal();return()=>{generation.current++;dialog.current?.close();};},[]);
 async function load(){const serial=++generation.current;setBusy(true);try{const result=await api<Config>('/api/connection-config');if(serial===generation.current){setConfig(result);setMessage('');}}catch(e){if(serial===generation.current)setMessage((e as Error).message);}finally{if(serial===generation.current)setBusy(false);}}
 useEffect(()=>{void load();try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(saved){setFields({...empty,...saved.fields});setSelected(saved.selected||'');}}catch{setMessage('连接编辑草稿无法读取。');}},[]);
 const current=config?.connections.find(host=>host.id===selected);
 function change(patch:Partial<typeof empty>,id=selected){const next={...fields,...patch};setFields(next);try{sessionStorage.setItem(draftKey,JSON.stringify({selected:id,fields:next}));}catch{setMessage('草稿无法保存，请保留当前页面。');}}
 function select(id:string){setSelected(id);const host=config?.connections.find(item=>item.id===id);const next=host?{alias:host.alias,address:host.address,port:host.port||22,user:host.user,home:host.home,binary:host.binary,identityFile:''}:empty;setFields(next);try{sessionStorage.setItem(draftKey,JSON.stringify({selected:id,fields:next}));}catch{setMessage('草稿无法保存，请保留当前页面。');}}
 async function save(action:string){
  if(!config||busy)return;
  if(action==='probe'){setBusy(true);setMessage('正在检测…');try{const result=await api<{message:string}>('/api/connection-probe',{method:'POST',body:{id:selected,connection:fields}});setMessage(result.message);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}return;}
  if(action==='remove'&&!await confirmAction('移除此入口的连接配置。目标机器上的会话和任务会继续运行。',{title:'移除连接',accept:'移除'}))return;
  const serial=++generation.current;setConnectionSavePending(true);setBusy(true);setMessage('正在保存…');
  try{
   flush();
   const connection=selected?{alias:fields.alias,binary:fields.binary,...current?.kind==='ssh'?{identityFile:fields.identityFile}:{}}:{...fields,kind:'ssh'};
   await api('/api/connection-config',{method:'POST',body:{revision:config.revision,action,id:selected,connection}});
   sessionStorage.removeItem(draftKey);setMessage('已保存，正在刷新连接。');
  }catch(e){if(serial===generation.current)setMessage((e as Error).message);}
  finally{if(serial===generation.current)setBusy(false);setConnectionSavePending(false);}
 }
 return createPortal(<dialog className="sidebar-dialog connection-editor" ref={dialog} aria-labelledby="connection-editor-title" onCancel={event=>{if(busy)event.preventDefault();else closed();}} onClose={closed}><form onSubmit={event=>{event.preventDefault();void save(selected?'edit':'add');}} onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault();}}><h2 id="connection-editor-title">管理连接</h2><label>连接<select value={selected} disabled={busy||!config} onChange={event=>select(event.target.value)}><option value="">新增 SSH 连接</option>{config?.connections.map(host=><option key={host.id} value={host.id}>{host.alias}{config.defaultConnection===host.id?'（默认）':''}</option>)}</select></label><label>名称<input required maxLength={80} value={fields.alias} disabled={busy} onChange={e=>change({alias:e.target.value})}/></label>{!selected&&<><label>地址<input required value={fields.address} disabled={busy} onChange={e=>change({address:e.target.value})}/></label><label>SSH 端口<input required type="number" min={1} max={65535} value={fields.port} disabled={busy} onChange={e=>change({port:Number(e.target.value)})}/></label><label>用户名<input required value={fields.user} disabled={busy} onChange={e=>change({user:e.target.value})}/></label><label>HOME 目录<input required value={fields.home} disabled={busy} onChange={e=>change({home:e.target.value})}/></label></>}<label>Codex 路径<input required value={fields.binary} disabled={busy} onChange={e=>change({binary:e.target.value})}/></label>{(!selected||current?.kind==='ssh')&&<label>本机 SSH 私钥路径<input required={!selected} placeholder={selected?'留空保留现有路径':undefined} value={fields.identityFile} disabled={busy} onChange={e=>change({identityFile:e.target.value})}/></label>}{selected&&<p className="subtle">更换目标机器时请新增连接，保留原目标的草稿与记录。</p>}<p role="status" aria-live="polite" className="subtle">{message}</p><div className="sidebar-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}>重新读取</button><button type="button" className="secondary-button" disabled={busy} onClick={closed}>关闭</button><button type="button" className="secondary-button" disabled={busy||!config} onClick={()=>void save('probe')}>检测</button><button type="submit" className="primary-button" disabled={busy||!config}>保存</button></div>{selected&&<div className="settings-actions"><button type="button" className="secondary-button" disabled={busy||config?.defaultConnection===selected} onClick={()=>void save('default')}>设为默认</button>{current?.kind==='ssh'&&<button type="button" className="text-button release-button" disabled={busy} onClick={()=>void save('remove')}>移除连接</button>}</div>}</form></dialog>,document.body);
}
