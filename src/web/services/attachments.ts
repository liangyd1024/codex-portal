import type {StoreApi} from 'zustand';
import {installComposerClipboard} from '../../../public/composer-clipboard.js';
export interface AttachmentItem {id:string;name:string;url?:string;[field:string]:unknown}
export interface CapturedAttachments {id:string|null;items:(AttachmentItem & {url:string})[]}
interface StorageLike {getItem:(key:string)=>string|null|undefined;setItem:(key:string,value:string)=>unknown}
type Notify=(message:string,error?:boolean)=>void;
interface Context {id:string|null;ready:boolean;busy:boolean}
export interface AttachmentView {id:string|null;busy:boolean;items:AttachmentItem[]}
export interface AttachmentButtonControl {store:StoreApi<{disabled:boolean}>;open:()=>void;setDisabled:(disabled:boolean)=>void}
export interface AttachmentViewOptions {form:HTMLFormElement;prefix:string;addFiles:(files:File[])=>Promise<void>;remove:(id:string|null,key:string)=>void}
type ViewInstaller=(options:AttachmentViewOptions)=>{list:HTMLElement;preview:HTMLDialogElement;images:AttachmentButtonControl;render:(view:AttachmentView)=>void};
interface Options {host:string;context:()=>Context;changed:()=>void;notify:Notify;form?:HTMLFormElement;input?:HTMLTextAreaElement;prefix?:string}

export class AttachmentDrafts {
  storage:StorageLike;key:string;notify:Notify;items:Map<string|null,AttachmentItem[]>;
  constructor(storage:StorageLike,key:string,notify:Notify=()=>{}) {this.storage=storage;this.key=key;this.notify=notify;this.items=new Map();try{for(const [id,items] of JSON.parse(storage.getItem(key)||'[]') as [unknown,unknown][])if(typeof id==='string'&&Array.isArray(items))this.items.set(id,(items as AttachmentItem[]).filter(i=>typeof i.id==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(i.url as string)));}catch{}}
  get(id:string|null):AttachmentItem[]{return this.items.get(id)||[];}
  save(){try{this.storage.setItem(this.key,JSON.stringify([...this.items].map(([id,items])=>[id,items.filter(i=>i.url)])));}catch{this.notify('图片暂时仅保留在当前页面，刷新可能丢失，请先发送或减少图片。',true);}}
  add(id:string|null,item:AttachmentItem){this.items.set(id,[...this.get(id),item]);this.save();}
  remove(id:string|null,key:string){this.items.set(id,this.get(id).filter(i=>i.id!==key));this.save();}
  capture(id:string|null):CapturedAttachments{return {id,items:this.get(id).filter((i):i is AttachmentItem & {url:string}=>Boolean(i.url)).map(i=>({...i}))};}
  acknowledge(sent:CapturedAttachments){const ids=new Set(sent.items.map(i=>i.id));this.items.set(sent.id,this.get(sent.id).filter(i=>!ids.has(i.id)));this.save();}
}
async function prepare(file:File):Promise<string>{
  if(!file.type.startsWith('image/')||file.size>25*1024*1024)throw Error('请选择小于 25 MB 的图片。');
  const img=new Image();
  try{
    // The application's img-src policy permits data images, but not blob URLs.
    img.src=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(reader.error);reader.onabort=()=>reject(Error('图片读取已取消。'));reader.readAsDataURL(file);});
    await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);let data;for(const quality of [.86,.7,.5,.3]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=1000000)return data;}throw Error('图片压缩后仍过大，请裁剪后重试。');
  }catch(error){const e=error as {message?:string}|null;throw Error(e?.message?.includes('过大')?e.message:'无法读取此图片，请转为 JPEG、PNG 或 WebP 后重试。');}
}
export function installAttachments({host,context,changed,notify,form=document.getElementById('message-form') as HTMLFormElement,input=document.getElementById('message-input') as HTMLTextAreaElement,prefix=''}:Options){
  const store=new AttachmentDrafts(sessionStorage,'rcm.images.'+host,notify);
  const view=installAttachmentView({form,prefix,addFiles:add,remove:(id,key)=>{store.remove(id,key);changed();}});
  const {list,preview}=view;
  let selected:string|null|undefined,clipboard:{sync:()=>void}|undefined;
  function render(){clipboard?.sync();const c=context();if(selected!==c.id){selected=c.id;if(preview.open)preview.close();}view.images.setDisabled(!c.ready||c.busy);const items=store.get(c.id);view.render({id:c.id,busy:Boolean(c.busy),items});}

  async function add(files:Iterable<File>){const c=context();if(!c.ready||c.busy)return;const id=c.id;for(const f of files){if(store.get(id).length>=4){notify('每条消息最多添加 4 张图片。',true);break;}const item:AttachmentItem={id:crypto.randomUUID(),name:f.name||'粘贴图片'};store.add(id,item);changed();try{const url=await prepare(f);if(store.get(id).includes(item)){item.url=url;store.save();}}catch(e){store.remove(id,item.id);notify((e as Error).message,true);}finally{changed();}}}
  clipboard=installComposerClipboard({input,list,context,items:()=>store.get(context().id),replace:(items:AttachmentItem[])=>{store.items.set(context().id,items);store.save();changed();},addFiles:add,notify});
  return {images:view.images,render,moveDraft:(from:string,to:string)=>{store.items.set(to,store.get(from));store.items.delete(from);store.save();},has:()=>store.get(context().id).some(i=>i.url),pending:()=>store.get(context().id).some(i=>!i.url),capture:()=>store.capture(context().id),acknowledge:(s:CapturedAttachments)=>store.acknowledge(s)};
}

let attachmentViewInstaller:ViewInstaller|undefined;
export function configureAttachmentView(installer:ViewInstaller){attachmentViewInstaller=installer;}
function installAttachmentView(options:AttachmentViewOptions){
  if(!attachmentViewInstaller)throw new Error('附件视图尚未初始化。');
  return attachmentViewInstaller(options);
}
