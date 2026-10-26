import {createRef,type RefObject} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {createFilePreview,type FilePreviewView,type FilePreviewOptions} from '../services/file-preview';
import {copyText} from '../services/feedback';
interface Instance extends FilePreviewOptions {id:number;dialog:RefObject<HTMLDialogElement|null>;content:RefObject<HTMLDivElement|null>;close:RefObject<HTMLButtonElement|null>;copyStatus:RefObject<HTMLSpanElement|null>;store:StoreApi<FilePreviewView>;controller?:ReturnType<typeof createFilePreview>}
let sequence=0;
const registry=createStore<{instance:Instance|null}>(()=>({instance:null}));
export function FilePreview(){const instance=useStore(registry,s=>s.instance);return instance?<Panel key={instance.id} instance={instance}/>:null;}
function Panel({instance:i}:{instance:Instance}){
 const v=useStore(i.store);
 const path=v.path||i.reference;
 return createPortal(<dialog ref={i.dialog} className="file-viewer" aria-label={'文件预览：'+(v.title||i.label)} onClick={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
  <div className="file-viewer-header"><strong>{v.title||i.label}</strong><button ref={i.close} type="button" className="secondary-button" onClick={()=>i.dialog.current!.close()}>关闭</button></div>
  {path&&<p className="file-viewer-path">{path}</p>}
  <div className="file-viewer-actions">
   {path&&<button type="button" className="secondary-button" onClick={event=>void copyText(path,{button:event.currentTarget,status:i.copyStatus.current!,failure:'复制失败，请选择上方路径复制。'})}>复制路径</button>}
   <a className="secondary-button" href={i.url('download')} hidden={v.downloadHidden}>下载文件</a>
   <a className="secondary-button" href={i.url(v.externalMode||'content')} target="_blank" rel="noopener noreferrer" hidden={v.externalHidden}>{v.externalMode==='html'?'浏览器打开':'新标签页打开'}</a>
   <span ref={i.copyStatus} role="status" className="file-copy-status"/>
  </div>
  <p className="file-viewer-status" role="status" hidden={v.statusHidden}>{v.status}</p>
  {/* Browser media lifecycle alone owns this stable subtree. */}
  <div ref={i.content} className="file-viewer-content"/>
  <button type="button" className="secondary-button" hidden={v.retryHidden} onClick={()=>void i.controller!.load()}>重试</button>
 </dialog>,document.body);
}
export function installReactFilePreview(options:FilePreviewOptions){
 const i:Instance={...options,id:++sequence,dialog:createRef(),content:createRef(),close:createRef(),copyStatus:createRef(),store:createStore<FilePreviewView>(()=>({retryHidden:true,downloadHidden:true,externalHidden:true,statusHidden:false,status:'正在读取文件…'}))};
 flushSync(()=>registry.setState({instance:i}));
 i.controller=createFilePreview({content:i.content.current!,label:i.label,url:i.url,publish:view=>flushSync(()=>i.store.setState(view))});
 const dialog=i.dialog.current!;
 dialog.addEventListener('close',()=>{i.controller!.close();flushSync(()=>{if(registry.getState().instance===i)registry.setState({instance:null});});if(i.opener.isConnected)i.opener.focus();},{once:true});
 dialog.showModal();i.close.current!.focus();void i.controller.load();return dialog;
}
