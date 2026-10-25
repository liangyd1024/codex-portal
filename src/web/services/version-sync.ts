interface Version {version?:string}
interface Options {flush:()=>void;reload:()=>void;onError:(error:unknown)=>void;schedule?:typeof setTimeout}
// Keep the version observer independent of the lazily opened settings panel.
export function createVersionSync({flush,reload,onError,schedule=setTimeout}:Options){
 let version:string|null|undefined=null,reloading=false,composing=false,pending:Version|null=null;
 const receive=(value:unknown)=>{
  const data=value as Version;
  if(!version)version=data.version;
  if(!data.version)return;
  if(data.version===version||data.version==='development'){pending=null;return;}
  pending=data;
  if(composing||reloading)return;
  try{flush();reloading=true;reload();}catch(error){reloading=false;onError(error);}
 };
 return {receive,compositionStart(){composing=true;},compositionEnd(){composing=false;if(pending)schedule(()=>{if(pending)receive(pending);},0);}};
}
