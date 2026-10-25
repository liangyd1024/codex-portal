export interface FilePreviewView {retryHidden:boolean;downloadHidden:boolean;externalHidden:boolean;statusHidden:boolean;status:string}
export interface FilePreviewOptions {opener:HTMLElement;label:string;url:(mode:string)=>string}
interface FileResult {error?:{message?:string};name:string;size:number;kind:string;text?:string;truncated?:boolean}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text?:string)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
async function responseJSON(url:string,signal:AbortSignal):Promise<FileResult>{const response=await fetch(url,{signal});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'文件读取失败，请重试。');return result;}
export function createFilePreview({content,label,url,publish}:{content:HTMLElement;label:string;url:FilePreviewOptions['url'];publish:(view:Partial<FilePreviewView>)=>void}){
  let request:AbortController|undefined,closed=false;
  const stop=()=>{
    request?.abort();
    for(const media of content.querySelectorAll<HTMLMediaElement>('video,audio')){media.pause();media.removeAttribute('src');media.load();}
    content.replaceChildren();
  };
  const load=async()=>{
    stop();request=new AbortController();const signal=request.signal;
    publish({retryHidden:true,downloadHidden:true,externalHidden:true,statusHidden:false,status:'正在读取文件…'});
    try {
      const info=await responseJSON(url('meta'),signal);
      if(closed||signal.aborted)return;
      publish({downloadHidden:false});let statusText=info.name+' · '+(info.size/1024/1024>=1?(info.size/1024/1024).toFixed(1)+' MB':Math.ceil(info.size/1024)+' KB');publish({status:statusText});
      if(['video','audio','image'].includes(info.kind)){
        const media=node(info.kind==='image'?'img':info.kind as 'video'|'audio');media.className='file-preview-media';
        if(info.kind==='image')(media as HTMLImageElement).alt=label;
        else {(media as HTMLMediaElement).controls=true;(media as HTMLMediaElement).preload='metadata';media.setAttribute('playsinline','');}
        const ready=statusText;publish({status:ready+' · 正在加载…'});
        const done=()=>{if(!closed&&!signal.aborted)publish({status:ready});};
        media.addEventListener(info.kind==='image'?'load':'loadedmetadata',done);
        if(info.kind!=='image'){
          media.addEventListener('waiting',()=>{if(!closed&&!signal.aborted)publish({status:ready+' · 正在缓冲…'});});
          media.addEventListener('playing',done);
          media.addEventListener('seeked',done);
          media.addEventListener('stalled',()=>{if(!closed&&!signal.aborted){publish({status:ready+' · 读取较慢，可稍候或重试',retryHidden:false});}});
        }
        media.addEventListener('error',()=>{if(closed||signal.aborted)return;publish({status:'无法预览：格式可能不受浏览器支持、文件已变化或连接已中断。可重试或下载文件。',retryHidden:false});});
        media.src=url('content');content.append(media);publish({externalHidden:false});
      } else if(info.kind==='text'){
        const result=await responseJSON(url('text'),signal);if(closed||signal.aborted)return;
        const pre=node('pre','file-preview-text',result.text);pre.tabIndex=0;pre.setAttribute('aria-label','文件内容，可滚动');content.append(pre);
        if(result.truncated)publish({status:statusText+' · 仅预览前 1 MiB，完整内容请下载'});
      } else if(info.kind==='pdf'){
        const frame=node('iframe','file-preview-pdf');frame.title=label;frame.src=url('content');content.append(frame);publish({externalHidden:false});
        publish({status:statusText+' · 如未显示，请在新标签页打开或下载'});
      } else publish({status:statusText+' · 此格式暂不支持预览，请下载后打开'});
    } catch(error){if(closed||signal.aborted)return;publish({status:(error as Error).message||'连接中断，请重试。',retryHidden:false});}
  };
 return {load,close(){closed=true;stop();}};
}
let installer:((options:FilePreviewOptions)=>HTMLDialogElement)|undefined,activeViewer:HTMLDialogElement|undefined;
export function configureFilePreview(value:NonNullable<typeof installer>){installer=value;}
export function closeFileViewer(){activeViewer?.close();}
export function openFileViewer(opener:HTMLElement,label:string,url:FilePreviewOptions['url']){closeFileViewer();if(!installer)throw Error('文件预览尚未初始化。');const dialog=installer({opener,label,url});activeViewer=dialog;dialog.addEventListener('close',()=>{if(activeViewer===dialog)activeViewer=undefined;},{once:true});}
