import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {createPushKeys,validateSubscription,sendPush} from '../../../lib/web-push.mjs';
import {asyncQuestions} from '../../../shared/questions.js';
import {taskNotice} from '../../../shared/connection-state.js';
import type {MobileAccess} from './mobile-access';
type Subscription={endpoint:string;keys:{auth:string;p256dh:string}};
type Device={subscription:Subscription;owner:string;host:string;subject:string};
type Job={device:string;payload:Record<string,unknown>;attempt:number;next:number;expires:number};
type Watch={host:string;threadId:string;seen:string[];expires:number;next?:number};
type State={watches?:Record<string,Watch>;keys:ReturnType<typeof createPushKeys>;devices:Record<string,Device>;jobs:Record<string,Job>;seen:Record<string,number>};
export class PushNotifications {
 private state:State|undefined;private timer:ReturnType<typeof setTimeout>|undefined;private running=false;private closed=false;private watchTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private file:string,private access:MobileAccess,private send=sendPush,private readHistory?:(host:string,id:string)=>Promise<{data?:any[]}>){try{this.state=JSON.parse(readFileSync(file,'utf8'));this.schedule();this.scheduleWatch();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
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
 publicKey(){const key=this.data().keys.publicKey;this.save();return key;}
 private valid(d:Device){const expiry=this.access.sessions[d.owner];return d.owner==='local'||expiry===null||typeof expiry==='number'&&expiry>Date.now();}
 private id(host:string,endpoint:string){return createHash('sha256').update(host+'\0'+endpoint).digest('hex');}
 subscribe(host:string,owner:string,subject:string,value:unknown){const subscription=validateSubscription(value);const s=this.data(),id=this.id(host,subscription.endpoint);if(Object.keys(s.devices).length>=100&&!s.devices[id])throw Error('推送设备数量已达上限。');s.devices[id]={subscription,owner,host,subject};this.save();return {ok:true};}
 remove(host:string,owner:string,endpoint:string){const s=this.data(),id=this.id(host,endpoint);if(s.devices[id]?.owner===owner){delete s.devices[id];for(const [key,job] of Object.entries(s.jobs))if(job.device===id)delete s.jobs[key];this.save();}return {ok:true};}
 async test(host:string,owner:string,endpoint:string,testId?:string){if(testId!==undefined&&!/^[a-zA-Z0-9-]{16,80}$/.test(testId))throw Error('测试标识无效。');const id=this.id(host,endpoint),d=this.data().devices[id];if(!d||d.owner!==owner||!this.valid(d))throw Error('请先开启此设备的后台通知。');const status=await this.send(d.subscription,{title:'Codex · 测试通知',body:'后台推送已接入',tag:'codex-test-'+(testId||Date.now()),data:{host,testId}},this.data().keys,d.subject);if(status<200||status>=300)throw Error('推送服务未接受测试通知（HTTP '+status+'），请重新开启通知后重试。');return {ok:true};}
 receive(host:string,event:unknown){if(!this.state)return;const {method,params}=(event||{}) as {method:string;params:any};if(!params)return;
 const notice=taskNotice(method,params,{host,known:true});if(!notice)return;
 const threadId=params.threadId||params.thread?.id||(params.request||params).params?.threadId;
 for(const [id,d] of Object.entries(this.state.devices))if(d.host===host&&this.valid(d))this.enqueue(id,notice.key,{title:'Codex · '+notice.label,body:'打开应用查看会话',tag:createHash('sha256').update(notice.key).digest('hex'),data:{host,threadId}});
 }
 private enqueue(device:string,key:string,payload:Record<string,unknown>){const s=this.data(),id=device+':'+key,now=Date.now();if(s.seen[id]||s.jobs[id])return;if(Object.keys(s.jobs).length>=1000)return;s.jobs[id]={device,payload,attempt:0,next:now,expires:now+3600000};this.save();this.schedule();}
 private schedule(){if(this.closed||this.running||!this.state)return;clearTimeout(this.timer);const jobs=Object.values(this.state.jobs);if(!jobs.length)return;this.timer=setTimeout(()=>void this.drain(),Math.max(0,Math.min(...jobs.map(j=>j.next))-Date.now()));this.timer.unref();}
 async drain(){if(this.running||this.closed||!this.state)return;this.running=true;try{const s=this.state;for(const [id,j] of Object.entries(s.jobs)){if(this.closed)break;const d=s.devices[j.device];if(!d||!this.valid(d)||j.expires<Date.now()){delete s.jobs[id];if(d&&!this.valid(d))delete s.devices[j.device];continue;}if(j.next>Date.now())continue;
 let status=0;try{status=await this.send(d.subscription,j.payload,s.keys,d.subject);}catch{}
 if(status===404||status===410){delete s.devices[j.device];delete s.jobs[id];}
 else if(status>=200&&status<300){s.seen[id]=Date.now();delete s.jobs[id];}
 else if((status===0||status===429||status>=500)&&++j.attempt<6){j.next=Date.now()+Math.min(300000,5000*2**j.attempt);}
 else delete s.jobs[id];
 }for(const [id,time] of Object.entries(s.seen))if(time<Date.now()-7*86400000)delete s.seen[id];const seen=Object.keys(s.seen);for(const id of seen.slice(0,Math.max(0,seen.length-10000)))delete s.seen[id];this.save();}finally{this.running=false;this.schedule();}}
 close(){this.closed=true;clearTimeout(this.timer);clearTimeout(this.watchTimer);}
}
