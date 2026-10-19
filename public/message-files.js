const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
let activeViewer;
export function closeFileViewer(){activeViewer?.close();}
export function itemFileUrl(threadId,itemId,reference,host,mode='content') {
  return '/api/threads/'+encodeURIComponent(threadId)+'/items/'+encodeURIComponent(itemId)+'/file?'+new URLSearchParams({reference,host,mode});
}
export function fileLink(reference,label,{threadId,itemId,host}) {
  if(!reference.startsWith('/')||reference.startsWith('//')||/[\x00-\x1f]/.test(reference))return null;
  const url=mode=>itemFileUrl(threadId,itemId,reference,host,mode);
  const link=node('a','message-file-link');link.href=url('download');link.title=reference;
  link.onclick=event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openViewer(link,link.textContent||label||reference.split('/').at(-1),url);};
  return link;
}
async function responseJSON(url,signal){
  const response=await fetch(url,{signal});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message||'文件读取失败，请重试。');
  return result;
}
function openViewer(opener,label,url) {
  closeFileViewer();
  const dialog=node('dialog','file-viewer'),header=node('div','file-viewer-header'),title=node('strong','',label),close=node('button','secondary-button','关闭');
  dialog.setAttribute('aria-label','文件预览：'+label);close.type='button';
  const actions=node('div','file-viewer-actions'),download=node('a','secondary-button','下载文件'),external=node('a','secondary-button','新标签页打开');
  download.href=url('download');external.href=url('content');external.target='_blank';external.rel='noopener noreferrer';external.hidden=true;download.hidden=true;
  actions.append(download,external);
  const content=node('div','file-viewer-content'),status=node('p','file-viewer-status','正在读取文件…'),retry=node('button','secondary-button','重试');
  status.setAttribute('role','status');retry.type='button';retry.hidden=true;
  header.append(title,close);dialog.append(header,actions,status,content,retry);
  let request,closed=false;
  const stop=()=>{
    request?.abort();
    for(const media of content.querySelectorAll('video,audio')){media.pause();media.removeAttribute('src');media.load();}
    content.replaceChildren();
  };
  const load=async()=>{
    stop();request=new AbortController();const signal=request.signal;
    retry.hidden=true;download.hidden=true;external.hidden=true;status.hidden=false;status.textContent='正在读取文件…';
    try {
      const info=await responseJSON(url('meta'),signal);
      if(closed||signal.aborted)return;
      download.hidden=false;status.textContent=info.name+' · '+(info.size/1024/1024>=1?(info.size/1024/1024).toFixed(1)+' MB':Math.ceil(info.size/1024)+' KB');
      if(['video','audio','image'].includes(info.kind)){
        const media=node(info.kind==='image'?'img':info.kind);media.className='file-preview-media';
        if(info.kind==='image')media.alt=label;
        else {media.controls=true;media.preload='metadata';media.setAttribute('playsinline','');}
        const ready=status.textContent;status.textContent=ready+' · 正在加载…';
        const done=()=>{if(!closed&&!signal.aborted)status.textContent=ready;};
        media.addEventListener(info.kind==='image'?'load':'loadedmetadata',done);
        if(info.kind!=='image'){
          media.addEventListener('waiting',()=>{if(!closed&&!signal.aborted)status.textContent=ready+' · 正在缓冲…';});
          media.addEventListener('playing',done);
          media.addEventListener('seeked',done);
          media.addEventListener('stalled',()=>{if(!closed&&!signal.aborted){status.textContent=ready+' · 读取较慢，可稍候或重试';retry.hidden=false;}});
        }
        media.addEventListener('error',()=>{if(closed||signal.aborted)return;status.textContent='无法预览：格式可能不受浏览器支持、文件已变化或连接已中断。可重试或下载文件。';retry.hidden=false;});
        media.src=url('content');content.append(media);external.hidden=false;
      } else if(info.kind==='text'){
        const result=await responseJSON(url('text'),signal);if(closed||signal.aborted)return;
        const pre=node('pre','file-preview-text',result.text);pre.tabIndex=0;pre.setAttribute('aria-label','文件内容，可滚动');content.append(pre);
        if(result.truncated)status.textContent+=' · 仅预览前 1 MiB，完整内容请下载';
      } else if(info.kind==='pdf'){
        const frame=node('iframe','file-preview-pdf');frame.title=label;frame.src=url('content');content.append(frame);external.hidden=false;
        status.textContent+=' · 如未显示，请在新标签页打开或下载';
      } else status.textContent+=' · 此格式暂不支持预览，请下载后打开';
    } catch(error){if(closed||signal.aborted)return;status.textContent=error.message||'连接中断，请重试。';retry.hidden=false;}
  };
  retry.onclick=load;close.onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{closed=true;stop();dialog.remove();if(activeViewer===dialog)activeViewer=null;if(opener.isConnected)opener.focus();},{once:true});
  document.body.append(dialog);activeViewer=dialog;dialog.showModal();close.focus();load();
}
