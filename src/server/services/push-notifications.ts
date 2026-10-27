import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {createPushKeys,validateSubscription,sendPush} from '../../../lib/web-push.mjs';
import {asyncQuestions} from '../../../shared/questions.js';
import {notificationTitle,notificationPreview} from '../../../shared/notification-text.js';
import {taskNotice} from '../../../shared/connection-state.js';
import type {MobileAccess} from './mobile-access';
type Subscription={endpoint:string;keys:{auth:string;p256dh:string}};
type Device={subscription:Subscription;owner:string;host:string;subject:string;updatedAt?:number};
type Job={device:string;payload:Record<string,unknown>;attempt:number;next:number;expires:number;context?:{key:string;threadId:string;turnId?:string;label:string;needsBody:boolean}};
type Watch={host:string;threadId:string;seen:string[];expires:number;next?:number};
type NavigationTrace={at:number;host:string;owner:string;stage:string;device?:string;threadId?:string;selectedId?:string;clickId?:string;testId?:string;version?:string;visibility?:string;windows?:number};
type State={navigation?:NavigationTrace[];watches?:Record<string,Watch>;keys:ReturnType<typeof createPushKeys>;devices:Record<string,Device>;jobs:Record<string,Job>;seen:Record<string,number>};
export class PushNotifications {
 private state:State|undefined;private timer:ReturnType<typeof setTimeout>|undefined;private running=false;private closed=false;private watchTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private file:string,private access:MobileAccess,private send=sendPush,private readHistory?:(host:string,id:string)=>Promise<{data?:any[]}>,private readNotice?:(host:string,id:string,turnId?:string|null)=>Promise<{name?:string;turn?:any}>){try{this.state=JSON.parse(readFileSync(file,'utf8'));this.compactDevices();this.schedule();this.scheduleWatch();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 private data(){return this.state ||= {keys:createPushKeys(),devices:{},jobs:{},seen:{}};}
 private save(){mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});writeFileSync(this.file+'.tmp',JSON.stringify(this.data()),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 hasDevices(host:string){return !!this.state&&Object.values(this.state.devices).some(d=>d.host===host&&this.valid(d));}
 observe(host:string,threadId:string,turns:any[]){
  if(!this.hasDevices(host))return;
  const s=this.data(),watches=s.watches ||= {},key=host+':'+threadId;
  const terminal=turns.filter(t=>['completed','failed','interrupted'].includes(t.status));
  const previous=watches[key];
  // Pending questions are actionable now, including on the first observed read.
  // Use the native question/reply parser, never infer requests from message text.
  for(const request of asyncQuestions(turns,threadId))this.receive(host,{method:'manager/request',params:request});
  if(previous)for(const turn of terminal)if(!previous.seen.includes(turn.id+':'+turn.status))this.receive(host,{method:'turn/completed',params:{threadId,turn}});
  watches[key]={host,threadId,seen:[...new Set([...(previous?.seen||[]),...terminal.map(t=>t.id+':'+t.status)])].slice(-200),expires:Date.now()+86400000,next:Date.now()+(turns.some(t=>['inProgress','in_progress','running'].includes(t.status))?15000:60000)};
  const keys=Object.keys(watches);if(keys.length>20)delete watches[keys[0]];
  if(!previous||JSON.stringify(previous.seen)!==JSON.stringify(watches[key].seen)||previous.expires<Date.now()+23*3600000)this.save();this.scheduleWatch();
 }
 private scheduleWatch(){if(this.closed||this.watchTimer||!this.readHistory||!Object.keys(this.state?.watches||{}).length)return;const delay=Math.max(1000,Math.min(...Object.values(this.state?.watches||{}).map(w=>w.next||Date.now()))-Date.now());this.watchTimer=setTimeout(()=>void this.poll(),delay);this.watchTimer.unref();}
 async poll(){if(this.closed||!this.state||!this.readHistory)return;try{for(const [key,w] of Object.entries(this.state.watches||{})){
   if(this.closed)break;if(w.expires<Date.now()||!this.hasDevices(w.host)){delete this.state.watches![key];continue;}
   if((w.next||0)>Date.now())continue;
   try{const snapshot=await this.readHistory(w.host,w.threadId);const expiry=w.expires;this.observe(w.host,w.threadId,snapshot.data||[]);if(this.state.watches?.[key])this.state.watches[key].expires=expiry;}catch{w.next=Date.now()+60000;}
  }this.save();}finally{this.watchTimer=undefined;this.scheduleWatch();}}
 trace(host:string,owner:string,value:Record<string,unknown>){
  const stages=['send-test','send-task','worker-push','worker-shown','worker-show-failed','worker-click','worker-window','page-ready','page-receiver','page-target','page-opened','page-failed'];
  if(typeof value.stage!=='string'||!stages.includes(value.stage))throw Error('通知诊断阶段无效。');
  const entry:NavigationTrace={at:Date.now(),host,owner,stage:value.stage};
  for(const key of ['threadId','selectedId','clickId','testId','version','visibility'] as const)if(typeof value[key]==='string')entry[key]=(value[key] as string).slice(0,160);
  if(typeof value.windows==='number'&&Number.isFinite(value.windows))entry.windows=Math.max(0,Math.min(100,value.windows));
  if(typeof value.endpoint==='string'){const id=this.id(host,value.endpoint),device=this.data().devices[id];if(device?.owner===owner)entry.device=id.slice(0,12);}
  const state=this.data();state.navigation=[...(state.navigation||[]),entry].slice(-160);this.save();return {ok:true};
 }
 traces(owner?:string){return (this.data().navigation||[]).filter(row=>!owner||row.owner===owner).map(({owner,...row})=>row);}
 publicKey(){const key=this.data().keys.publicKey;this.save();return key;}
 private valid(d:Device){const expiry=this.access.sessions[d.owner];return d.owner==='local'||expiry===null||typeof expiry==='number'&&expiry>Date.now();}
 private id(host:string,endpoint:string){return createHash('sha256').update(host+'\0'+endpoint).digest('hex');}
 // A pairing token identifies one browser installation. Renewed endpoints replace it.
 // Local browsers share the local owner, so their independent endpoints stay separate.
 private recipient(id:string,d:Device){return d.owner==='local'?id:createHash('sha256').update(JSON.stringify([d.owner,d.host,d.subject])).digest('hex');}
 private compactDevices(){
  const s=this.data(),latest=new Map<string,string>();
  for(const [id,d] of Object.entries(s.devices)){const key=this.recipient(id,d),previous=latest.get(key);if(!previous||(d.updatedAt||0)>=(s.devices[previous].updatedAt||0))latest.set(key,id);}
  let changed=false;const replacements=new Map<string,{recipient:string;device:string}>();
  for(const [id,d] of Object.entries(s.devices)){
   const recipient=this.recipient(id,d),device=latest.get(recipient)!;replacements.set(id,{recipient,device});
   if(id!==device){delete s.devices[id];changed=true;}
  }
  // Old per-endpoint claims become per-installation claims, so renewals cannot replay them.
  for(const [id,time] of Object.entries(s.seen)){
   const at=id.indexOf(':'),replacement=replacements.get(id.slice(0,at));if(!replacement)continue;
   const key=replacement.recipient+id.slice(at);
   if(key!==id){s.seen[key]=Math.max(s.seen[key]||0,time);delete s.seen[id];changed=true;}
  }
  for(const [id,job] of Object.entries(s.jobs)){
   const replacement=replacements.get(job.device);if(!replacement){delete s.jobs[id];changed=true;continue;}
   const key=replacement.recipient+id.slice(id.indexOf(':'));
   if(job.device!==replacement.device){job.device=replacement.device;changed=true;}
   if(s.seen[key]){delete s.jobs[id];changed=true;}
   else if(key!==id){s.jobs[key] ||= job;delete s.jobs[id];changed=true;}
  }
  if(changed)this.save();
 }
 subscribe(host:string,owner:string,subject:string,value:unknown){const subscription=validateSubscription(value);const s=this.data(),id=this.id(host,subscription.endpoint);
  const device={subscription,owner,host,subject,updatedAt:Date.now()};
  if(Object.keys(s.devices).length>=100&&!s.devices[id]&&!Object.entries(s.devices).some(([key,d])=>this.recipient(key,d)===this.recipient(id,device)))throw Error('推送设备数量已达上限。');
  s.devices[id]=device;this.compactDevices();this.save();return {ok:true};
 }
 devices(host:string){return Object.entries(this.data().devices).filter(([,d])=>d.host===host&&this.valid(d)).map(([id,d])=>({id,provider:new URL(d.subscription.endpoint).hostname,remote:d.owner!=='local',updatedAt:d.updatedAt}));}
 async testDevice(host:string,id:string,testId?:string,threadId?:string){const d=this.data().devices[id];if(!d||d.host!==host)throw Error('推送设备不存在。');return this.test(host,d.owner,d.subscription.endpoint,testId,threadId);}

 remove(host:string,owner:string,endpoint:string){const s=this.data(),id=this.id(host,endpoint);if(s.devices[id]?.owner===owner){delete s.devices[id];for(const [key,job] of Object.entries(s.jobs))if(job.device===id)delete s.jobs[key];this.save();}return {ok:true};}
 async test(host:string,owner:string,endpoint:string,testId?:string,threadId?:string){if(threadId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId))throw Error('测试会话标识无效。');if(testId!==undefined&&!/^[a-zA-Z0-9-]{16,80}$/.test(testId))throw Error('测试标识无效。');const id=this.id(host,endpoint),d=this.data().devices[id];if(!d||d.owner!==owner||!this.valid(d))throw Error('请先开启此设备的后台通知。');const context=threadId?await this.noticeContext(host,threadId,null):{name:undefined,turn:undefined};this.trace(host,owner,{stage:'send-test',threadId,testId,endpoint,version:'navigation-3'});const status=await this.send(d.subscription,{title:notificationTitle('测试通知',context.name,threadId),body:notificationPreview('turn/completed',{turn:context.turn})||(threadId?'这是此会话的测试通知。点按应打开对应会话正文。':'通知接收测试。请先选择会话，再测试点击定位。'),tag:'codex-test-'+(testId||Date.now()),data:{host,testId,threadId}},this.data().keys,d.subject);if(status<200||status>=300)throw Error('推送服务未接受测试通知（HTTP '+status+'），请重新开启通知后重试。');return {ok:true};}
 receive(host:string,event:unknown){if(!this.state)return;const {method,params,replayed}=(event||{}) as {method:string;params:any;replayed?:boolean};if(!params||replayed)return;
 const notice=taskNotice(method,params,{host,known:true});if(!notice)return;
 const threadId=params.threadId||params.thread?.id||(params.request||params).params?.threadId;
 const preview=notificationPreview(method,params);
 for(const [id,d] of Object.entries(this.state.devices))if(d.host===host&&this.valid(d))this.enqueue(id,notice.key,{title:notificationTitle(notice.label,params.thread?.name,threadId),body:preview||notice.label+'。点按查看会话。',tag:createHash('sha256').update(notice.key).digest('hex'),data:{host,threadId}},{key:notice.key,threadId,turnId:method==='turn/completed'?params.turn?.id:undefined,label:notice.label,needsBody:!preview});
 }
 private enqueue(device:string,key:string,payload:Record<string,unknown>,context:Job['context']){const s=this.data(),id=this.recipient(device,s.devices[device])+':'+key,now=Date.now();if(s.seen[id]||s.jobs[id])return;if(Object.keys(s.jobs).length>=1000)return;s.jobs[id]={device,payload,context,attempt:0,next:now,expires:now+3600000};this.save();this.schedule();}
 private schedule(){if(this.closed||this.running||!this.state)return;clearTimeout(this.timer);const jobs=Object.values(this.state.jobs);if(!jobs.length)return;this.timer=setTimeout(()=>void this.drain(),Math.max(0,Math.min(...jobs.map(j=>j.next))-Date.now()));this.timer.unref();}
 private async noticeContext(host:string,threadId:string,turnId?:string|null):Promise<{name?:string;turn?:any}>{
  if(!this.readNotice)return {};let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.readNotice(host,threadId,turnId),new Promise<{}>(resolve=>{timer=setTimeout(()=>resolve({}),4000);})]);}catch{return {};}finally{clearTimeout(timer);}
 }
 async drain(){if(this.running||this.closed||!this.state)return;this.running=true;const contexts=new Map<string,Promise<{name?:string;turn?:any}>>();try{const s=this.state;for(const [id,j] of Object.entries(s.jobs)){if(this.closed)break;const d=s.devices[j.device];if(!d||!this.valid(d)||j.expires<Date.now()){delete s.jobs[id];if(d&&!this.valid(d))delete s.devices[j.device];continue;}if(j.next>Date.now())continue;
 if(j.context){const c=j.context;let pending=contexts.get(c.key);if(!pending){pending=this.noticeContext(d.host,c.threadId,c.needsBody?c.turnId:undefined);contexts.set(c.key,pending);}const detail=await pending;if(this.closed)break;if(s.devices[j.device]!==d||s.jobs[id]!==j)continue;if(detail.name)j.payload.title=notificationTitle(c.label,detail.name,c.threadId);if(c.needsBody&&detail.turn?.id===c.turnId){const preview=notificationPreview('turn/completed',{turn:detail.turn});if(preview)j.payload.body=preview;}delete j.context;}
 this.trace(d.host,d.owner,{stage:'send-task',...(j.payload.data as Record<string,unknown>),endpoint:d.subscription.endpoint,version:'navigation-3'});
 let status=0;try{status=await this.send(d.subscription,j.payload,s.keys,d.subject);}catch{}
 if(status===404||status===410){delete s.devices[j.device];delete s.jobs[id];}
 else if(status>=200&&status<300){s.seen[id]=Date.now();delete s.jobs[id];}
 else if((status===0||status===429||status>=500)&&++j.attempt<6){j.next=Date.now()+Math.min(300000,5000*2**j.attempt);}
 else delete s.jobs[id];
 }for(const [id,time] of Object.entries(s.seen))if(time<Date.now()-7*86400000)delete s.seen[id];const seen=Object.keys(s.seen);for(const id of seen.slice(0,Math.max(0,seen.length-10000)))delete s.seen[id];this.save();}finally{this.running=false;this.schedule();}}
 close(){this.closed=true;clearTimeout(this.timer);clearTimeout(this.watchTimer);}
}
