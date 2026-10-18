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
  const url=URL.createObjectURL(file),img=new Image();
  try{img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);let data;for(const quality of [.86,.7,.5,.3]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=1000000)return data;}throw Error('图片压缩后仍过大，请裁剪后重试。');}catch(e){throw Error(e.message.includes('过大')?e.message:'无法读取此图片，请转为 JPEG、PNG 或 WebP 后重试。');}finally{URL.revokeObjectURL(url);}
}
export function installAttachments({host,context,changed,notify}){
  const store=new AttachmentDrafts(sessionStorage,'rcm.images.'+host,notify),form=document.getElementById('message-form'),input=document.getElementById('message-input');
  const button=document.createElement('button');button.id='add-images';button.type='button';button.className='icon-button';button.textContent='＋';button.setAttribute('aria-label','添加图片');button.title='添加图片';
  const file=document.createElement('input');file.type='file';file.accept='image/*';file.multiple=true;file.hidden=true;file.id='image-files';
  const list=document.createElement('div');list.className='attachment-list';list.setAttribute('aria-label','待发送图片');list.hidden=true;
  form.prepend(list);form.querySelector('.composer-bottom').prepend(button);form.append(file);
  const preview=document.createElement('dialog');preview.className='composer-dialog image-preview';document.body.append(preview);
  preview.addEventListener('click',e=>{if(e.target===preview)preview.close();});
  let selected;
  function render(){const c=context();if(selected!==c.id){selected=c.id;if(preview.open)preview.close();}button.disabled=!c.ready||c.busy;list.replaceChildren();const items=store.get(c.id);list.hidden=!items.length;
    for(const item of items){const card=document.createElement('div');card.className='attachment-card';const show=document.createElement('button');show.type='button';show.className='attachment-preview';show.setAttribute('aria-label','预览 '+item.name);if(item.url){const img=document.createElement('img');img.src=item.url;img.alt=item.name;show.append(img);show.onclick=()=>{preview.replaceChildren();const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=()=>preview.close();const large=document.createElement('img');large.src=item.url;large.alt=item.name;preview.append(close,large);preview.showModal();};}else{show.textContent='处理中…';show.disabled=true;}
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+item.name);remove.disabled=c.busy;remove.onclick=()=>{store.remove(c.id,item.id);changed();};card.append(show,remove);list.append(card);}}
  async function add(files){const c=context();if(!c.ready||c.busy)return;const id=c.id;for(const f of files){if(store.get(id).length>=4){notify('每条消息最多添加 4 张图片。',true);break;}const item={id:crypto.randomUUID(),name:f.name||'粘贴图片'};store.add(id,item);changed();try{const url=await prepare(f);if(store.get(id).includes(item)){item.url=url;store.save();}}catch(e){store.remove(id,item.id);notify(e.message,true);}finally{changed();}}}
  button.onclick=()=>file.click();file.onchange=()=>{const files=[...file.files];file.value='';void add(files);};
  input.addEventListener('paste',e=>{const files=[...e.clipboardData.files].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();void add(files);}});
  return {render,has:()=>store.get(context().id).some(i=>i.url),pending:()=>store.get(context().id).some(i=>!i.url),capture:()=>store.capture(context().id),acknowledge:s=>store.acknowledge(s)};
}
