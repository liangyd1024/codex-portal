interface ClipboardItem {id:string;name:string;url?:string;[field:string]:unknown}
interface Options {input:HTMLTextAreaElement;list:HTMLElement;context:()=>{id:string|null;busy:boolean;ready:boolean};items:()=>ClipboardItem[];replace:(items:ClipboardItem[])=>void;addFiles:(files:File[])=>Promise<void>;notify:(message:string,error?:boolean)=>void}
// Portable HTML is the cross-tab representation; no private clipboard cache.
const escapeHTML=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const safeImage=(url:unknown)=>typeof url==='string'&&url.length<=1100000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url);
export function clipboardHTML(text:string,items:ClipboardItem[]){return '<div data-rcm-composer="1"><pre>'+escapeHTML(text)+'</pre>'+items.map(i=>'<img src="'+escapeHTML(i.url)+'" alt="'+escapeHTML(i.name)+'">').join('')+'</div>';}
export function readClipboard(data:DataTransfer){
 const text=data.getData('text/plain'),html=data.getData('text/html');
 if(html.length>5000000)throw Error('粘贴内容过大。草稿已保留。');
 const doc=new DOMParser().parseFromString(html,'text/html');
 const root=doc.querySelector('[data-rcm-composer="1"]');
 const images=[...(root||doc).querySelectorAll('img')].filter(img=>safeImage(img.getAttribute('src'))).map(img=>({url:img.getAttribute('src')!,name:img.getAttribute('alt')||'粘贴图片'}));
 return {text:root?.querySelector('pre')?.textContent??text,images,own:!!root};
}
export function installComposerClipboard({input,list,context,items,replace,addFiles,notify}:Options){
 let selected:string|null=null;
 const clear=()=>{selected=null;list.classList.remove('attachments-selected');};
 const all=()=>selected===context().id&&input.selectionStart===0&&input.selectionEnd===input.value.length;
 const changed=()=>input.dispatchEvent(new Event('input',{bubbles:true}));
 input.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'&&!e.altKey){
   if(!items().length)return;e.preventDefault();input.select();selected=context().id;list.classList.add('attachments-selected');return;
  }
  if(all()&&['Backspace','Delete'].includes(e.key)&&!context().busy){e.preventDefault();replace([]);input.value='';clear();changed();return;}
  if(!['meta','control','shift','alt','c','x'].includes(e.key.toLowerCase()))clear();
 });
 input.addEventListener('pointerdown',clear);input.addEventListener('blur',clear);
 input.addEventListener('select',()=>{if(input.value.length&&input.selectionStart===0&&input.selectionEnd===input.value.length&&items().length){selected=context().id;list.classList.add('attachments-selected');}else if(selected&&!all())clear();});
 for(const kind of ['copy','cut'] as const)input.addEventListener(kind,e=>{
  if(!all()||!items().length)return;
  e.preventDefault();const c=context();if(c.busy||input.disabled)return;
  const pictures=items();if(pictures.some(i=>!i.url)){notify('图片仍在处理中，请稍后再复制或剪切。',true);return;}
  try{if(!e.clipboardData)throw Error();e.clipboardData.setData('text/plain',input.value);e.clipboardData.setData('text/html',clipboardHTML(input.value,pictures));}
  catch{notify('无法写入剪贴板，草稿已保留。',true);return;}
  if(kind==='cut'){replace([]);input.value='';clear();changed();}
 });
 input.addEventListener('paste',e=>{
  const c=context();if(input.disabled||!c.ready||c.busy){e.preventDefault();return;}
  try{
   const data=readClipboard(e.clipboardData!),files=[...(e.clipboardData!.files||[])].filter(f=>f.type.startsWith('image/'));
   if(!data.own&&!data.images.length&&!files.length){if(all())replace([]);clear();return;}
   e.preventDefault();const existing=all()?[]:items();
   const count=data.images.length||files.length;
   if(count+existing.length>4)throw Error('每条消息最多添加 4 张图片。草稿已保留。');
   if(all())replace([]);
   if(data.images.length)replace([...existing,...data.images.map(i=>({...i,id:crypto.randomUUID()}))]);
   input.setRangeText(data.text,input.selectionStart,input.selectionEnd,'end');clear();changed();
   if(!data.images.length&&files.length)void addFiles(files);
  }catch(error){e.preventDefault();notify((error as Error).message||'无法读取剪贴板，草稿已保留。',true);}
 });
 return {sync(){if(selected!==context().id)clear();}};
}
