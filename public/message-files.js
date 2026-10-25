const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
import {openFileViewer} from '../src/web/services/file-preview.ts';
export {closeFileViewer} from '../src/web/services/file-preview.ts';
export function itemFileUrl(threadId,itemId,reference,host,mode='content') {
  return '/api/threads/'+encodeURIComponent(threadId)+'/items/'+encodeURIComponent(itemId)+'/file?'+new URLSearchParams({reference,host,mode});
}
export function fileLink(reference,label,{threadId,itemId,host}) {
  if(!reference.startsWith('/')||reference.startsWith('//')||/[\x00-\x1f]/.test(reference))return null;
  const url=mode=>itemFileUrl(threadId,itemId,reference,host,mode);
  const link=node('a','message-file-link');link.href=url('download');link.title=reference;
  link.onclick=event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openFileViewer(link,link.textContent||label||reference.split('/').at(-1),url);};
  return link;
}
