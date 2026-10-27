import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {readLiveStatus} from './status-read.mjs';
import {createHash} from 'node:crypto';
import {authRecoveryMessage} from '../shared/account-state.js';

// Connection maintenance only: no local task queue or replay of user input.
export function accountIdentity(value) {
  const a=value?.account;
  return JSON.stringify(a?{type:a.type,email:a.email||null,workspace:value.workspaceRouting?.chatgptAccountId||null}:null);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class AccountRecovery {
  constructor(manager,{read=null,interval=15000}={}) {
    this.m=manager;this.interval=interval;this.read=read||this.readSaved.bind(this);
    this.store=manager.titleStore?manager.titleStore+'.account-monitor.json':null;
    if(this.store)try{this.saved=JSON.parse(readFileSync(this.store,'utf8'));}catch{}
    this.attempted=this.saved?.attempted;
  }
  start(){if(this.timer||this.running)return;this.schedule(0);}
  stop(){clearTimeout(this.timer);this.timer=null;}
  schedule(delay=this.interval){this.stop();this.timer=setTimeout(()=>{this.timer=null;void this.tick();},delay);this.timer.unref?.();}
  async readSaved(probe=false){
    const script=await readFile(new URL('../scripts/account-probe.py',import.meta.url),'utf8');
    return this.m.remote(`PAYLOAD={'probe':${probe?'True':'False'}}\n${script}`,{timeoutMs:30000,reuse:true});
  }
  async tick(){
    if(this.running)return;
    const m=this.m;if(m.connection.state!=='connected')return;
    this.running=true;
    const rpc=m.rpc,generation=m.generation;
    let reloading=false;
    const current=()=>{if(m.rpc!==rpc||m.generation!==generation||!rpc.connected)throw Error('账号检查期间连接已变化。');};
    try{
      if(m.releasing||m.mutations||m.startingTurns.size||Date.now()<(this.nextProbeAt||0))return;
      const signal=await this.read(false);current();
      // File metadata is only a change signal. The native process owns identity.
      // Keychain-backed storage has no file signal, so recheck at most once/minute.
      const changed=!this.saved||this.saved.stamp!==signal.stamp;
      const fallback=signal.stamp==='absent'&&Date.now()-(this.probedAt||0)>=60000;
      if(this.checkedGeneration===generation&&!changed&&!m.loginRecovery&&!fallback)return;
      if(!changed&&!fallback&&this.attempted?.stamp===signal.stamp)return;
      const observed=await this.read(true);current();this.probedAt=Date.now();
      // Ignore a file change while the native probe was starting; recheck later.
      if(observed.stamp!==signal.stamp)return;
      const identity=observed.identity;
      if(!identity||!Object.hasOwn(identity,'account'))throw Error('无法确认已保存登录。');
      const identityKey=createHash('sha256').update(accountIdentity(identity)).digest('hex');
      if(!changed&&this.attempted?.stamp===signal.stamp&&this.attempted.identity===identityKey)return;
      if(!identity.account&&identity.requiresOpenaiAuth!==false){
        m.setLoginRecovery('目标 Codex 尚未登录。完成登录后会自动加载，无需点击重新加载。');
        this.saved={stamp:signal.stamp};this.attempted={stamp:signal.stamp,identity:identityKey};
        this.saved.attempted=this.attempted;
        m.saveState(this.store,this.saved);return;
      }
      const live=await readLiveStatus(m,'account/read',{refreshToken:false}).catch(error=>{
        const recovery=authRecoveryMessage(error);if(!recovery)throw error;
        m.setLoginRecovery(recovery);return null;
      });current();
      this.checkedGeneration=generation;
      const changedKey=identity.account?.type==='apiKey'&&this.saved&&changed;
      const needsReload=!!m.loginRecovery||changedKey||accountIdentity(identity)!==accountIdentity(live);
      this.saved={stamp:signal.stamp};m.saveState(this.store,this.saved);
      if(!needsReload){this.attempted=null;return;}
      if(this.failureSignal!==signal.stamp){this.failureSignal=signal.stamp;this.failures=0;}
      this.attempted={stamp:signal.stamp,identity:identityKey};
      this.saved.attempted=this.attempted;m.saveState(this.store,this.saved);
      m.setLoginRecovery('登录状态已变化，正在自动停止任务并加载新登录。失败消息不会自动重发。');
      await this.quiesce(rpc,generation);
      reloading=true;
      await m.reloadLogin({allEntrancesDisconnected:true},true);
      this.attempted=null;
      delete this.saved.attempted;m.saveState(this.store,this.saved);
    }catch(error){
      // One attempt per observed login generation. Never loop native restarts.
      this.nextProbeAt=Date.now()+60000;
      const retryPreparation=(!reloading||error.code==='SERVICE_BUSY')&&this.attempted&&++this.failures<3;
      if(retryPreparation){this.attempted=null;delete this.saved.attempted;m.saveState(this.store,this.saved);this.nextProbeAt=Date.now()+5000;}
      if(m.rpc===rpc&&m.generation===generation||reloading&&!m.manualDisconnect){
        m.record(error,'自动恢复登录',{diagnosticOnly:true});
        if(m.loginRecovery)m.setLoginRecovery('自动恢复登录尚未完成：'+error.message+(retryPreparation?'。稍后会自动重试。':'。登录再次变化后会自动重试。'));
      }
    }finally{
      this.running=false;
      if(m.connection.state==='connected')this.schedule();
    }
  }
  async quiesce(rpc,generation){
    const m=this.m;
    const current=()=>{m.requireConnected();if(m.rpc!==rpc||m.generation!==generation)throw Error('连接已变化，已停止自动维护。');};
    m.requireWritable();if(m.mutations||m.startingTurns.size)throw Error('消息正在提交，稍后再恢复。');
    m.releasing=true;m.publish('manager/status',m.status());
    try{
      let cursor;const visited=new Set(),ids=new Set();
      do{
        const page=await rpc.request('thread/loaded/list',cursor?{cursor}:{});current();
        if(!Array.isArray(page.data))throw Error('无法确认已加载会话。');
        for(const id of page.data)ids.add(id);
        cursor=page.nextCursor;if(cursor&&visited.has(cursor))throw Error('会话分页未推进。');visited.add(cursor);
      }while(cursor);
      for(const id of ids){
        current();
        const {goal}=await rpc.request('thread/goal/get',{threadId:id}).catch(error=>{
          if(error.message===`ephemeral thread does not support goals: ${id}`)return {goal:null};throw error;
        });current();
        if(goal?.status==='active')await rpc.request('thread/goal/set',{threadId:id,status:'paused',origin:'user'});
        current();
        const {thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false});current();
        let running=[];
        if(thread?.status?.type==='active'){
          const known=m.activeTurns.get(id);
          if(known)running=[{id:known}];
          else{
            const history=await rpc.request('thread/turns/list',{threadId:id,limit:5,sortDirection:'desc',itemsView:'summary'});current();
            if(!Array.isArray(history.data))throw Error('无法确认会话轮次。');
            running=history.data.filter(t=>t.status==='inProgress');
            if(!running.length)throw Error('运行轮次尚未确认，未重启引擎。');
          }
        }
        for(const turn of running){
          await rpc.request('turn/interrupt',{threadId:id,turnId:turn.id});current();
        }
        const terminals=await rpc.request('thread/backgroundTerminals/list',{threadId:id,limit:100});current();
        if(!Array.isArray(terminals.data)||terminals.nextCursor)throw Error('后台命令列表不完整，已停止自动维护。');
        for(const terminal of terminals.data){
          await rpc.request('thread/backgroundTerminals/terminate',{threadId:id,processId:terminal.processId});current();
        }
      }
      // Termination acknowledgements precede terminal status notifications.
      for(let i=0;i<10;i++){
        current();if(!m.activeTurns.size&&!m.requests.size&&!m.pendingQuestions.entries.size)return;
        await sleep(200);
      }
      throw Error('任务结束状态尚未确认，未重启引擎。');
    }finally{m.releasing=false;m.publish('manager/status',m.status());}
  }
}
