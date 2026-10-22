import {AppError} from './core/errors.mjs';
// Inline image inputs work identically over local and SSH engine transports.
export function messageInput(text='',images=[]) {
  if(typeof text!=='string'||text.length>100000)throw new AppError('消息不能超过 100000 字符。');
  if(!Array.isArray(images)||images.length>4)throw new AppError('每条消息最多添加 4 张图片。');
  const input=text.trim()?[{type:'text',text:text.trim()}]:[];let total=0;
  for(const image of images){
    const url=image?.url;
    const match=typeof url==='string'&&url.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match||url.length>3*1024*1024)throw new AppError('图片格式无效，请重新选择 PNG、JPEG 或 WebP 图片。');
    const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
    const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid||bytes.toString('base64')!==match[2]||bytes.length>2*1024*1024||total>4*1024*1024)throw new AppError('图片无效或过大，请重新选择。');
    input.push({type:'image',url});
  }
  if(!input.length)throw new AppError('请输入消息或添加图片。');
  return input;
}
