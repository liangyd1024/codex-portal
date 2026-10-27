import {sharedDesktopState} from '../../../lib/shared-desktop.mjs';
import {Manager} from '../../../lib/manager.mjs';
import {taskNotice} from '../../../shared/connection-state.js';
import {summarizeTitle} from '../../../lib/thread-title.mjs';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
interface EventParams {threadId?:string;thread?:{id?:string};[field:string]:unknown}
interface TitleState {pendingFirstMessage?:boolean;manual?:boolean;lastTitle?:string;[field:string]:unknown}
/** RCM presentation and persistence policies. RPC/IPC/SSH execution stays in the native adapter. */
export class WorkspaceManager extends Manager {
 declare expectedHost:{id?:string;alias?:string};
 declare notices:Map<string,{method:string;params:EventParams}>;
 declare autoTitles:Map<string,TitleState>;
 declare titleJobs:Map<string,Promise<unknown>>;
  override status() {
    const live=this.connection.state==='connected'&&this.rpc?.connected;
    return {instanceId:this.instanceId,revision:this.statusRevision,loginRecovery:this.loginRecovery||null,host: this.host, connection: this.connection, service: {...this.service,sharedDesktop:sharedDesktopState(this.expectedHost).configured,sharedDesktopReady:sharedDesktopState(this.expectedHost).activated,releasing:this.releasing},
      controlledSessions:[...this.controlled].map(([id,info])=>({id,...info,status:live?info.status||{type:'unknown'}:{type:'unknown'},pendingRequests:[...this.requests.values()].filter(request=>request.threadId===id).length})),
      subscribedThreads:[...this.subscriptions].filter(([,v])=>!v.handoff).map(([id])=>id), handoffs:this.handoffs.entries().filter(v=>!v.automatic), controlledThreads: [...this.controlled.keys()], pendingRequests: [...this.requests.values(),...this.pendingQuestions.entries.values()], recoveryFailures:[...this.recoveryFailures.values()], errors: this.errors};
  }
  override publish(method:string, params:EventParams, {replayed=false}={}) {
    if(method==='manager/status')params={...params,revision:++this.statusRevision};
    const threadId=params.threadId||params.thread?.id;
    const notice=taskNotice(method,params,{host:this.expectedHost.id || this.expectedHost.alias,known:this.subscriptions.has(threadId)});
    if(notice&&method!=='manager/request'&&!this.notices.has(notice.key)){
      this.notices.set(notice.key,{method,params});
      this.saveState(this.noticeStore,[...this.notices]);
    }
    // Recovered terminal history is available through normal history reads.
    // Do not broadcast it as a fresh completion, including to older open tabs.
    if(!replayed)this.emit('event', {method, params});
  }
  override saveState(file:string|null|undefined,value:unknown) {
    if(!file)return;
    mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);
  }
  override replayNotices() {
    return [...this.notices].map(([key,event])=>({method:'manager/taskNotice',params:{key,event}}));
  }
  override acknowledgeNotice(key:string) {
    // Older pending records used the display alias; accept their canonical ID key too.
    let acknowledged=this.notices.delete(key);
    for(const [stored,event] of this.notices){
      if(taskNotice(event.method,event.params,{host:this.expectedHost.id || this.expectedHost.alias,known:true})?.key===key){
        this.notices.delete(stored);acknowledged=true;
      }
    }
    if(acknowledged)this.saveState(this.noticeStore,[...this.notices]);
    return {acknowledged};
  }
  override restoreConnection() {
    if(this.restoreOnStart&&[...this.subscriptions.values()].some(v=>!v.handoff||v.handoff.automatic||v.handoff.state!=='released'))return this.connect();
  }
  override update(patch:Record<string,unknown>) { this.connection = {...this.connection, ...patch}; this.publish('manager/status', this.status()); }
  override record(caught:unknown, stage = this.connection.stage, {diagnosticOnly=false} = {}) {
    const error=caught as Error;
    const entry = {message: error.message || String(error), stage, time: new Date().toISOString(), ...(diagnosticOnly?{diagnosticOnly:true}:{})};
    this.errors = [...this.errors.slice(-29), entry]; this.publish('manager/error', entry); return entry;
  }
  override clearDiagnosticHistory() {
    // Acknowledge past diagnostics only; keep subscriptions and live execution state.
    this.errors = [];
    this.recoveryFailures.clear();
    const status = this.status();
    this.publish('manager/status', status);
    return status;
  }
  override saveSubscriptions() {
    if(!this.subscriptionStore)return;
    // Write handoff intent first; old releases must also see no auto-resume entry.
    this.saveState(this.handoffStore,[...this.subscriptions].filter(([,v])=>v.handoff).map(([id,v])=>[id,v.handoff]));
    this.saveState(this.subscriptionStore,[...this.subscriptions].filter(([,v])=>!v.handoff));
  }
  override titleFromFirstInput(id:string,text:string,options:{hasImages?:boolean}={}) {
    const naming=this.autoTitles.get(id);
    if(!naming?.pendingFirstMessage||naming.manual)return;
    // Consume only accepted input. Naming failures must not retry native work.
    naming.pendingFirstMessage=false;this.saveTitles();
    this.updateTitle(id,summarizeTitle(text,options));
  }
  override saveTitles() {
    if(!this.titleStore)return;
    try{mkdirSync(path.dirname(this.titleStore),{recursive:true,mode:0o700});writeFileSync(this.titleStore+'.tmp',JSON.stringify([...this.autoTitles]),{mode:0o600});renameSync(this.titleStore+'.tmp',this.titleStore);}catch(error){this.record(error,'保存自动标题状态');}
  }
  override updateTitle(id:string,name:string|undefined) {
    const info=this.autoTitles.get(id),rpc=this.rpc,generation=this.generation;
    if(!info||!name||info.manual||info.lastTitle||!rpc?.connected||this.titleJobs.has(id))return;
    const current=()=>this.rpc===rpc&&this.generation===generation&&rpc.connected&&!info.manual&&this.autoTitles.get(id)===info&&!this.subscriptions.get(id)?.handoff;
    const task=Promise.resolve().then(async()=>{
      if(!current())return;
      // Preserve an explicit title assigned from another entrance before this write.
      // turn/start can return before the new rollout's metadata has been flushed.
      // Retry only this read; never repeat the accepted message or name write.
      let thread;
      for(let attempt=0;;attempt++){
        if(!current())return;
        try{({thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false}));break;}
        catch(caught){
          const error=caught as Error;
          if(attempt>=4||!/no rollout found for thread id|rollout at [^\n]+ is empty$/i.test(error.message))throw error;
          await new Promise(resolve=>setTimeout(resolve,100*2**attempt));
        }
      }
      if(!current()||thread.name?.trim())return;
      await rpc.request('thread/name/set',{threadId:id,name});
      if(!current())return;
      info.lastTitle=name;this.saveTitles();
      this.publish('thread/name/updated',{threadId:id,threadName:name});
    }).catch(error=>this.record(error,'自动命名'))
      .finally(()=>{if(this.titleJobs.get(id)===task)this.titleJobs.delete(id);});
    this.titleJobs.set(id,task);
    return task;
  }
}
