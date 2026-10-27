export interface DesktopSettings {model:string;reasoningEffort?:string|null;[key:string]:unknown}
interface Context {key:string;id:string|null;available:boolean;settings?:DesktopSettings|null}
interface Dependencies {
 context:()=>Context;busy:Set<string>;
 post:(path:string,body:{model:string;effort:string;expected:{model:string;reasoningEffort:string|null}})=>Promise<{settings:DesktopSettings}>;
 apply:(settings:DesktopSettings)=>void;refresh:()=>Promise<unknown>;render:(syncSettings:boolean)=>void;notify:(message:string,error?:boolean)=>void;
}
export function createDesktopSettings(d:Dependencies){
 return async function updateDesktopSettings(model:string,effort:string){
  const before=d.context();
  if(!before.id||!before.available||!before.settings?.model||!model||!effort||d.busy.size)return;
  const key=before.key,current=()=>d.context().key===key;
  d.busy.add('desktop-settings');d.render(true);
  try{
   const result=await d.post('/api/desktop/threads/'+encodeURIComponent(before.id)+'/settings',{model,effort,expected:{model:before.settings.model,reasoningEffort:before.settings.reasoningEffort??null}});
   if(current()){d.apply(result.settings);d.notify('桌面设置已更新，下一轮生效。');}
  }catch(error){if(current())d.notify((error as Error).message,true);}
  finally{
   if(current())try{await d.refresh();}catch{if(current())d.notify('桌面设置暂未刷新，请重新核对。',true);}
   d.busy.delete('desktop-settings');d.render(current());
  }
 };
}
