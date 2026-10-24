// Keep the version observer independent of the lazily opened settings panel.
export function createVersionSync({flush,reload,onError,schedule=setTimeout}){
 let version=null,reloading=false,composing=false,pending=null;
 const receive=data=>{
  if(!version)version=data.version;
  if(!data.version)return;
  if(data.version===version||data.version==='development'){pending=null;return;}
  pending=data;
  if(composing||reloading)return;
  try{flush();reloading=true;reload();}catch(error){reloading=false;onError(error);}
 };
 return {receive,compositionStart(){composing=true;},compositionEnd(){composing=false;if(pending)schedule(()=>{if(pending)receive(pending);},0);}};
}
