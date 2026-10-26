import {sourcePreview} from './file-preview-text.ts';
export interface FilePreviewView {retryHidden:boolean;downloadHidden:boolean;externalHidden:boolean;externalMode?:'content'|'html';statusHidden:boolean;status:string;title?:string;path?:string}
export interface FilePreviewOptions {opener:HTMLElement;label:string;reference?:string;url:(mode:string)=>string}
interface FileResult {error?:{message?:string;retryable?:boolean};name:string;path?:string;size:number;kind:string;text?:string;truncated?:boolean;line?:number;column?:number;htmlPreview?:boolean}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text?:string)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
async function responseJSON(url:string,signal:AbortSignal):Promise<FileResult>{const response=await fetch(url,{signal});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message||'文件读取失败，请重试。'),{retryable:result.error?.retryable??(response.status>=500||[408,409,429].includes(response.status))});return result;}
export function createFilePreview({content,label,url,publish}:{content:HTMLElement;label:string;url:FilePreviewOptions['url'];publish:(view:Partial<FilePreviewView>)=>void}){
  let request:AbortController|undefined,closed=false;
  const stop=()=>{
    request?.abort();
    for(const media of content.querySelectorAll<HTMLMediaElement>('video,audio')){media.pause();media.removeAttribute('src');media.load();}
    content.replaceChildren();
  };
  const load=async()=>{
    if(closed)return;
    stop();request=new AbortController();const signal=request.signal;
    publish({retryHidden:true,downloadHidden:true,externalHidden:true,externalMode:'content',statusHidden:false,status:'正在读取文件…'});
    try {
      const info=await responseJSON(url('meta'),signal);
      if(closed||signal.aborted)return;
      publish({downloadHidden:false,title:info.name,path:info.path});let statusText=(info.size/1024/1024>=1?(info.size/1024/1024).toFixed(1)+' MB':Math.ceil(info.size/1024)+' KB');publish({status:statusText});
      if(['video','audio','image'].includes(info.kind)){
        const media=node(info.kind==='image'?'img':info.kind as 'video'|'audio');media.className='file-preview-media';
        if(info.kind==='image')(media as HTMLImageElement).alt=label;
        else {(media as HTMLMediaElement).controls=true;(media as HTMLMediaElement).preload='metadata';media.setAttribute('playsinline','');}
        const ready=statusText;publish({status:ready+' · 正在加载…'});
        const done=()=>{if(!closed&&!signal.aborted)publish({status:ready,retryHidden:true});};
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
        if(info.htmlPreview){publish({externalHidden:false,externalMode:'html'});statusText+=' · 浏览器预览仅加载内嵌资源';}
        const result=await responseJSON(url('text'),signal);if(closed||signal.aborted)return;
        const text=result.text||'',line=result.line??info.line;
        const source=sourcePreview(text,line);content.append(source.pre);source.locate();
        if(line)statusText+=' · 第 '+line+' 行'+(info.column&&info.column>1?'，第 '+info.column+' 列':'')+(source.found?'':'（不在当前预览范围）');
        if(result.truncated)statusText+=' · 仅预览前 1 MiB，完整内容请下载';
        publish({status:statusText});
        if(/\.(md|markdown)$/i.test(info.name)&&text.length<=200000&&text.split('\n',5001).length<=5000){
          const toolbar=node('div','file-preview-text-tools'),toggle=node('button','secondary-button','排版预览');toggle.type='button';toggle.setAttribute('aria-pressed','false');
          toolbar.append(toggle);content.prepend(toolbar);
          let rendered:HTMLElement|undefined,rendering=false;
          const togglePreview=async()=>{
            if(rendering||closed||signal.aborted)return;
            if(rendered){const show=rendered.hidden;rendered.hidden=!show;source.pre.hidden=show;toggle.textContent=show?'查看源码':'排版预览';toggle.setAttribute('aria-pressed',String(show));if(!show)source.locate();return;}
            rendering=true;toggle.disabled=true;
            try{
              const {markdown}=await import('../../../public/message-body.js');
              if(closed||signal.aborted)return;
              const body:HTMLElement=markdown(text);body.classList.add('file-preview-markdown');content.append(body);rendered=body;
              source.pre.hidden=true;toggle.textContent='查看源码';toggle.setAttribute('aria-pressed','true');
            }catch{if(!closed&&!signal.aborted)publish({status:statusText+' · 排版预览加载失败，可重试或阅读源码'});}
            finally{rendering=false;toggle.disabled=false;}
          };
          toggle.onclick=()=>void togglePreview();
          if(!line)void togglePreview();
        }
      } else if(info.kind==='pdf'){
        const frame=node('iframe','file-preview-pdf');frame.title=label;frame.src=url('content');content.append(frame);publish({externalHidden:false});
        publish({status:statusText+' · 如未显示，请在新标签页打开或下载'});
      } else publish({status:statusText+' · 此格式暂不支持预览，请下载后打开'});
    } catch(error){if(closed||signal.aborted)return;publish({status:(error as Error).message||'连接中断，请重试。',retryHidden:(error as Error&{retryable?:boolean}).retryable===false});}
  };
 return {load,close(){closed=true;stop();}};
}
let installer:((options:FilePreviewOptions)=>HTMLDialogElement)|undefined,activeViewer:HTMLDialogElement|undefined;
export function configureFilePreview(value:NonNullable<typeof installer>){installer=value;}
export function closeFileViewer(){activeViewer?.close();}
export function openFileViewer(opener:HTMLElement,label:string,url:FilePreviewOptions['url'],reference?:string){closeFileViewer();if(!installer)throw Error('文件预览尚未初始化。');const dialog=installer({opener,label,url,reference});activeViewer=dialog;dialog.addEventListener('close',()=>{if(activeViewer===dialog)activeViewer=undefined;},{once:true});}
