export interface LocalNotificationContext {host:string;selectedId:string|null;threads:Array<{id:string;name:string}>}
interface Dependencies {
 context:()=>LocalNotificationContext;
 prepare:()=>Promise<Pick<ServiceWorkerRegistration,'showNotification'|'getNotifications'>>;
 trace:(stage:string,target:{host:string;threadId:string;testId:string})=>unknown;
 uuid:()=>string;
}
export function createLocalNotificationTest({context,prepare,trace,uuid}:Dependencies){
 let pending:Promise<string|undefined>|null=null;
 function test(host:string,threadId:string):Promise<string|undefined>{
  if(pending)return pending;
  const initial=context(),thread=initial.threads.find(row=>row.id===threadId);
  if(host!==initial.host||!thread)return Promise.resolve('目标会话不在当前连接的会话列表中，请重新打开通知诊断。');
  const target={host,threadId,testId:'LOCAL-'+uuid()},tag='codex-local-'+target.testId;
  const current=()=>context().host===host;
  const record=(stage:string)=>{try{void Promise.resolve(trace(stage,target)).catch(()=>{});}catch{}};
  pending=(async()=>{
   try{
    const registration=await prepare();
    if(!current())return;
    if(!context().threads.some(row=>row.id===threadId))return '目标会话已不在当前连接列表中，请重新选择。';
    record('local-test-requested');
    await registration.showNotification('本机对照 · '+thread.name,{body:'点按此通知，验证是否打开所选会话。',tag,data:target});
    record('local-test-shown');
    const notifications=await registration.getNotifications({tag});
    const saved=notifications.find(item=>item.tag===tag);
    const verified=saved?.data?.host===host&&saved?.data?.threadId===threadId&&saved?.data?.testId===target.testId;
    record(verified?'local-test-verified':'local-test-mismatch');
    if(current())return verified?'系统显示调用已成功，保存的目标已核对。请点击“本机对照”通知验证跳转。':'系统显示调用已成功，但未读到目标一致的通知，尚不能确认保存结果。';
   }catch{
    record('local-test-failed');
    if(current())return '本机对照未完成，通知显示或读取失败。未发送远程推送，请检查系统通知权限。';
   }
  })().finally(()=>{pending=null;});
  return pending;
 }
 return {test};
}
