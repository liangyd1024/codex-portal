export interface LocalNotificationContext {host:string;selectedId:string|null;threads:Array<{id:string;name:string}>}
export interface RemoteNotificationChoice {tag:string;testId:string;threadId:string;name:string;navigate:boolean;status:'verified'|'mismatch'|'other-host'}
export interface RemoteNotificationResult {message:string;choices:RemoteNotificationChoice[]}
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
 let remotePending:Promise<RemoteNotificationResult|undefined>|null=null;
 // A bounded, in-memory snapshot belongs to the registration used for this read.
 let snapshot:{host:string;registration:Awaited<ReturnType<Dependencies['prepare']>>;choices:RemoteNotificationChoice[]}|null=null;
 const recordRemote=(stage:string,target:{host:string;threadId:string;testId:string})=>{try{void Promise.resolve(trace(stage,target)).catch(()=>{});}catch{}};
 const valid=(notice:Notification,host:string)=>{
  const data=notice.data;
  return data?.host===host&&typeof data.testId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(data.testId)&&notice.tag==='codex-test-'+data.testId&&context().threads.some(row=>row.id===data.threadId);
 };
 function readRemote(host:string):Promise<RemoteNotificationResult|undefined>{
  if(remotePending)return remotePending;
  snapshot=null;
  remotePending=(async()=>{
   try{
    const registration=await prepare();if(context().host!==host)return;
    const notices=await registration.getNotifications();if(context().host!==host)return;
    const choices:RemoteNotificationChoice[]=notices.filter(notice=>/^codex-test-[a-zA-Z0-9-]{16,80}$/.test(notice.tag)).slice(-20).map(notice=>{
     const testId=notice.tag.slice('codex-test-'.length),data=notice.data;
     const thread=context().threads.find(row=>row.id===data?.threadId);
     const status=data?.host!==host?(typeof data?.host==='string'?'other-host':'mismatch'):valid(notice,host)?'verified':'mismatch';
     return {tag:notice.tag,testId,threadId:status==='verified'?data.threadId:'',name:status==='verified'?thread!.name:status==='other-host'?'当前连接外':'保存目标不一致',navigate:Boolean((notice as Notification&{navigate?:string}).navigate),status};
    });
    snapshot={host,registration,choices};
    for(const choice of choices)recordRemote(choice.status==='other-host'?'remote-read-other-host':choice.status==='mismatch'?'remote-read-mismatch':choice.navigate?'remote-read-navigate':'remote-read-verified',{host,threadId:choice.threadId,testId:choice.testId});
    return {choices,message:choices.length?'已读到远程测试通知；请查看各编号的目标核对结果。目标不一致或当前连接外的通知不能复制。请先不要点击原通知。':'本次未读到当前连接列表内的远程测试通知。这不能证明手机未收到或接收器未执行。'};
   }catch{if(context().host===host)return {choices:[],message:'读取未完成，请保留原通知。本次没有发送或补发通知。'};}
  })().finally(()=>{remotePending=null;});return remotePending;
 }
 function copyRemote(host:string,tag:string):Promise<string|undefined>{
  if(pending)return pending;
  const source=snapshot,choice=source?.choices.find(row=>row.tag===tag);
  if(!source||source.host!==host||context().host!==host||!choice||choice.status!=='verified')return Promise.resolve('请先读取并选择当前连接的远程测试通知。');
  pending=(async()=>{
   try{
    const notices=await source.registration.getNotifications({tag});if(context().host!==host)return;
    const notice=notices.find(item=>item.tag===tag);
    if(!notice||!valid(notice,host)||notice.data.threadId!==choice.threadId||notice.data.testId!==choice.testId)return '原通知已不存在或保存目标改变，请重新读取；未生成对照。';
    // Read Notification getters explicitly. Never copy delivery credentials or
    // fallback identifiers into a locally generated diagnostic notification.
    const navigate=(notice as Notification&{navigate?:string}).navigate;
    if(navigate)return '该通知保存了系统导航地址，不属于本轮点击回调对照；未生成对照。';
    const testId=choice.testId+'-COPY-'+uuid(),copyTag='codex-local-'+testId;
    const data={host,threadId:choice.threadId,testId};
    const options:NotificationOptions={body:notice.body,tag:copyTag,data,dir:notice.dir,lang:notice.lang,icon:notice.icon,silent:notice.silent,requireInteraction:notice.requireInteraction};
    const extra=notice as Notification&{badge?:string;renotify?:boolean;timestamp?:number;vibrate?:number[];actions?:Array<{action:string;title:string;icon?:string}>};
    for(const key of ['badge','renotify','timestamp','vibrate','actions'] as const)if(extra[key]!==undefined)Object.assign(options,{[key]:extra[key]});
    await source.registration.showNotification('本机保存对照 · '+notice.title,options);
    recordRemote('remote-copy-shown',data);
    const saved=(await source.registration.getNotifications({tag:copyTag})).find(item=>item.tag===copyTag);
    const verified=saved?.data?.host===host&&saved?.data?.threadId===choice.threadId&&saved?.data?.testId===testId;
    recordRemote(verified?'remote-copy-verified':'remote-copy-mismatch',data);
    if(context().host===host)return verified?'本机对照显示调用成功，保存目标已核对。请点击“本机保存对照”通知验证。':'本机对照显示调用成功，但保存目标未核实；不代表已收到。';
   }catch{if(context().host===host)return '保存内容对照未完成。没有远程补发，请保留原通知。';}
  })().finally(()=>{pending=null;});return pending;
 }
 return {test,readRemote,copyRemote};
}
