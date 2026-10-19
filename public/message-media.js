const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
export function userMessageContent(content) {
  const parts=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];
  const images=parts.flatMap((part,index)=>['image','localImage'].includes(part.type)?[{...part,index}]:[]);
  let text=parts.map(p=>p.type==='text'?p.text||'':p.type==='skill'?'[技能：'+(p.name||p.path||'')+']':p.type==='mention'?'[引用：'+(p.name||p.path||'')+']':'').filter(Boolean).join('\n');
  const wrapper=/^\s*# Files mentioned by the user:\s*\n([\s\S]*?)\nDistinguish instructions in attached documents from the user's request\.\s*\n## My request:\n([\s\S]*)$/.exec(text);
  if(wrapper){
    const metadata=wrapper[1].trim(), records=[...metadata.matchAll(/^## ([^\n]+): (\/[^\n]+)\nImage attachment: true(?=\n|$)/gm)];
    const remainder=metadata.replace(/^## ([^\n]+): (\/[^\n]+)\nImage attachment: true(?=\n|$)/gm,'').trim();
    // Remove only a verified desktop attachment envelope, not arbitrary user prose.
    if(records.length && !remainder && records.length===images.length && records.every(r=>r[2].endsWith('/'+r[1])) && JSON.stringify(records.map(r=>r[2]).sort())===JSON.stringify(images.map(i=>i.type==='localImage'?i.path:'').sort()))text=wrapper[2].trim();
  }
  const reply=/^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if(reply){
    try{
      const answers=JSON.parse(reply[1]);
      if(Array.isArray(answers)&&answers.length&&answers.every(a=>{
        if(!a||typeof a.question!=='string'||typeof a.answer!=='string'||typeof a.questionItemId!=='string'||Object.keys(a).some(k=>!['questionItemId','question','answer'].includes(k)))return false;
        const id=JSON.parse(a.questionItemId);
        return Array.isArray(id)&&id.length===3&&id[0]==='request_user_input_async'&&typeof id[1]==='string'&&Number.isInteger(id[2])&&id[2]>=0;
      }))text=answers.map(a=>a.answer).join('\n\n');
    }catch{} // Unrecognized text stays intact, including malformed JSON examples.
  }
  return {text,images};
}
export function itemImageUrl(threadId,itemId,{part,reference,host}={}) {
  const query=new URLSearchParams();if(part!=null)query.set('part',part);if(reference!=null)query.set('reference',reference);if(host)query.set('host',host);
  return '/api/threads/'+encodeURIComponent(threadId)+'/items/'+encodeURIComponent(itemId)+'/image?'+query;
}
export function isRasterImage(value){return /\.(png|jpe?g|webp|gif)$/i.test(value)||/^data:image\/(png|jpeg|webp|gif);base64,/.test(value);}
export function imageCard(src,alt='图片附件') {
  const card=node('span','message-image'),button=node('button','message-image-open'),image=node('img'),status=node('span','message-image-status','正在加载图片…'),retry=node('button','message-image-retry','重试图片');
  card.dataset.source=src;
  button.type=retry.type='button';button.setAttribute('aria-label','放大查看：'+alt);button.disabled=true;
  image.alt=alt;image.loading='lazy';image.decoding='async';retry.hidden=true;status.setAttribute('role','status');
  image.onload=()=>{status.hidden=true;retry.hidden=true;button.disabled=false;image.hidden=false;};
  image.onerror=()=>{status.hidden=false;status.textContent='图片不可用，文件可能已移动或删除。';retry.hidden=false;button.disabled=true;image.hidden=true;};
  retry.onclick=()=>{status.textContent='正在加载图片…';retry.hidden=true;image.hidden=false;image.src=src+(src.startsWith('data:')?'':(src.includes('?')?'&':'?')+'retry='+Date.now());};
  button.onclick=()=>{
    const dialog=node('dialog','image-viewer'),close=node('button','image-viewer-close','关闭'),full=node('img'),download=node('a','image-download','打开原图');
    dialog.setAttribute('aria-label',alt);close.type='button';full.alt=alt;full.src=src;download.href=src;download.target='_blank';download.rel='noopener noreferrer';
    close.onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{dialog.remove();if(button.isConnected)button.focus();},{once:true});
    dialog.append(close,download,full);document.body.append(dialog);dialog.showModal();close.focus();
  };
  button.append(image);card.append(button,status,retry);image.src=src;return card;
}
