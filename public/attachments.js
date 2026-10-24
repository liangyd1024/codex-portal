import {installComposerClipboard} from './composer-clipboard.js';
export class AttachmentDrafts {
  constructor(storage,key,notify=()=>{}) {Object.assign(this,{storage,key,notify,items:new Map()});try{for(const [id,items] of JSON.parse(storage.getItem(key)||'[]'))if(typeof id==='string'&&Array.isArray(items))this.items.set(id,items.filter(i=>typeof i.id==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(i.url)));}catch{}}
  get(id){return this.items.get(id)||[];}
  save(){try{this.storage.setItem(this.key,JSON.stringify([...this.items].map(([id,items])=>[id,items.filter(i=>i.url)])));}catch{this.notify('图片暂时仅保留在当前页面，刷新可能丢失，请先发送或减少图片。',true);}}
  add(id,item){this.items.set(id,[...this.get(id),item]);this.save();}
  remove(id,key){this.items.set(id,this.get(id).filter(i=>i.id!==key));this.save();}
  capture(id){return {id,items:this.get(id).filter(i=>i.url).map(i=>({...i}))};}
  acknowledge(sent){const ids=new Set(sent.items.map(i=>i.id));this.items.set(sent.id,this.get(sent.id).filter(i=>!ids.has(i.id)));this.save();}
}
async function prepare(file){
  if(!file.type.startsWith('image/')||file.size>25*1024*1024)throw Error('请选择小于 25 MB 的图片。');
  const img=new Image();
  try{
    // The application's img-src policy permits data images, but not blob URLs.
    img.src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.onabort=()=>reject(Error('图片读取已取消。'));reader.readAsDataURL(file);});
    await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);let data;for(const quality of [.86,.7,.5,.3]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=1000000)return data;}throw Error('图片压缩后仍过大，请裁剪后重试。');
  }catch(e){throw Error(e?.message?.includes('过大')?e.message:'无法读取此图片，请转为 JPEG、PNG 或 WebP 后重试。');}
}
export function installAttachments({host,context,changed,notify,form=document.getElementById('message-form'),input=document.getElementById('message-input'),prefix=''}){
  const store=new AttachmentDrafts(sessionStorage,'rcm.images.'+host,notify);
  const button=document.createElement('button');button.id=prefix+'add-images';button.type='button';button.className='icon-button';button.textContent='＋';button.setAttribute('aria-label','添加图片');button.title='添加图片';
  const file=document.createElement('input');file.type='file';file.accept='image/*';file.multiple=true;file.hidden=true;file.id=prefix+'image-files';
  const list=document.createElement('div');list.className='attachment-list';list.setAttribute('aria-label','待发送图片');list.hidden=true;
  form.prepend(list);form.querySelector('.composer-bottom').prepend(button);form.append(file);
  const preview=document.createElement('dialog');preview.className='composer-dialog image-preview';document.body.append(preview);
  preview.addEventListener('click',e=>{if(e.target===preview)preview.close();});
  const view=installAttachmentView({list,preview,remove:(id,key)=>{store.remove(id,key);changed();}});
  let selected,clipboard;
  function render(){clipboard?.sync();const c=context();if(selected!==c.id){selected=c.id;if(preview.open)preview.close();}button.disabled=!c.ready||c.busy;const items=store.get(c.id);list.hidden=!items.length;view.render({id:c.id,busy:Boolean(c.busy),items});}

  async function add(files){const c=context();if(!c.ready||c.busy)return;const id=c.id;for(const f of files){if(store.get(id).length>=4){notify('每条消息最多添加 4 张图片。',true);break;}const item={id:crypto.randomUUID(),name:f.name||'粘贴图片'};store.add(id,item);changed();try{const url=await prepare(f);if(store.get(id).includes(item)){item.url=url;store.save();}}catch(e){store.remove(id,item.id);notify(e.message,true);}finally{changed();}}}
  button.onclick=()=>file.click();file.onchange=()=>{const files=[...file.files];file.value='';void add(files);};
  clipboard=installComposerClipboard({input,list,context,items:()=>store.get(context().id),replace:items=>{store.items.set(context().id,items);store.save();changed();},addFiles:add,notify});
  return {button,render,moveDraft:(from,to)=>{store.items.set(to,store.get(from));store.items.delete(from);store.save();},has:()=>store.get(context().id).some(i=>i.url),pending:()=>store.get(context().id).some(i=>!i.url),capture:()=>store.capture(context().id),acknowledge:s=>store.acknowledge(s)};
}

let attachmentViewInstaller;
export function configureAttachmentView(installer){attachmentViewInstaller=installer;}
function installAttachmentView(options){
  if(!attachmentViewInstaller)throw new Error('附件视图尚未初始化。');
  return attachmentViewInstaller(options);
}
