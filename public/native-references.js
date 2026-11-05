// Presentation only. File access is independently checked against the native message.
const attributeValue=String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|[^\s"'{}=]+`;
const attributeSource='([A-Za-z_]+)[ \t]*=[ \t]*('+attributeValue+')';
const tokenAttributes='[A-Za-z_]+[ \t]*=[ \t]*(?:'+attributeValue+')';
export const directiveSource=String.raw`(?<!:):{1,2}(?:codex-file-citation|codex-annotation|code-comment|created-thread)\{(?:`+tokenAttributes+String.raw`[ \t]*)+\}`;
export const legacySource=String.raw`【[^\n【】]+†L\d+(?:-L\d+)?】`;
export function attributes(token){
 const attrs=Object.create(null);
 for(const match of token.matchAll(new RegExp(attributeSource,'g'))){
  if(Object.hasOwn(attrs,match[1]))throw Error('Duplicate attribute');
  const value=match[2];
  attrs[match[1]]=value.startsWith('"')?JSON.parse(value):value.startsWith("'")?value.slice(1,-1).replace(/\\(['\\])/g,'$1'):value;
 }
 return attrs;
}
export function localReference(value){
 if(typeof value!=='string')return null;
 let path=value;
 try{
  if(path.startsWith('sandbox:'))path=decodeURIComponent(path.slice(8));
  else if(path.startsWith('file:')){
   const url=new URL(path);
   if(url.hostname&&url.hostname!=='localhost'||url.search)return null;
   path=decodeURIComponent(url.pathname)+url.hash;
  }
 }catch{return null;}
 return path.startsWith('/')&&!path.startsWith('//')&&!/[\x00-\x1f]/.test(path)?path:null;
}
export function lineReference(path,start,end){
 if(start===undefined)return path;
 if(!/^[1-9]\d*$/.test(start)||!Number.isSafeInteger(Number(start)))throw Error('Invalid line');
 if(end!==undefined&&(!/^[1-9]\d*$/.test(end)||!Number.isSafeInteger(Number(end))||Number(end)<Number(start)))throw Error('Invalid range');
 return path+'#L'+start+(end===undefined?'':'-L'+end);
}
export function nativeReference(token){
 const legacy=/^【([^\n]+)†L(\d+)(?:-L(\d+))?】$/.exec(token);
 if(legacy){const path=localReference(legacy[1].trim());return path?{kind:'file',path:lineReference(path,legacy[2],legacy[3])}:null;}
 const name=/^:{1,2}([a-z-]+)\{/.exec(token)?.[1],a=attributes(token);
 if(name==='codex-file-citation'){
  const path=localReference(a.path);return path?{kind:'file',path:lineReference(path,a.line_range_start,a.line_range_end)}:null;
 }
 if(name==='codex-annotation'&&/^[1-9]\d*$/.test(a.index)&&Number.isSafeInteger(Number(a.index)))return {kind:'annotation',label:'注释 '+a.index};
 if(name==='created-thread'&&typeof a.threadId==='string'&&/^[a-zA-Z0-9_-]+$/.test(a.threadId))return {kind:'thread',id:a.threadId,label:'查看会话'};
 if(name==='code-comment'&&a.title&&a.body&&a.file){
  const path=localReference(a.file);
  return {kind:'comment',title:a.title,body:a.body,file:a.file,path:path?lineReference(path,a.start,a.end):null};
 }
 return null;
}
