import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AppError} from './manager.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class NativeAutomations {
  constructor(manager){
    this.manager=manager;this.file=manager.titleStore?manager.titleStore+'.native-automations.json':null;
    this.state={threadId:null,submissions:{}};this.pending=false;
    try{if(this.file){const saved=JSON.parse(readFileSync(this.file,'utf8'));if(saved&&typeof saved==='object'&&saved.submissions&&typeof saved.submissions==='object'&&!Array.isArray(saved.submissions))this.state={threadId:uuid.test(saved.threadId||'')?saved.threadId:null,submissions:Object.fromEntries(Object.entries(saved.submissions).filter(([id,v])=>uuid.test(id)&&v&&typeof v==='object'))};}}catch{}
    for(const item of Object.values(this.state.submissions))if(item.status==='sending')item.status='unknown';
  }
  save(){this.manager.saveState(this.file,this.state);}
  async call(script,payload){
    const source=await readFile(new URL('../scripts/'+script,import.meta.url),'utf8');
    const data=Buffer.from(JSON.stringify(payload)).toString('base64');
    const result=await this.manager.remote(`import base64,json\nPAYLOAD=json.loads(base64.b64decode('${data}'))\n${source}`,{timeoutMs:60000});
    if(result.failure)throw new AppError(result.failure.message,409,result.failure.code);
    return result;
  }
  async list(){return {...await this.call('automation-store.py',{}),threadId:this.state.threadId};}
  async history(cursor,threadId){
    if(!this.state.threadId||threadId!==this.state.threadId)throw new AppError('管理会话已更换，请从定时任务入口重新打开。',409);
    return this.manager.passive('history',{threadId:this.state.threadId,cursor,withOutputs:true});
  }
  async interrupt({threadId,turnId}){
    if(threadId!==this.state.threadId||!uuid.test(turnId||''))throw new AppError('停止请求的会话或轮次无效。');
    if(this.manager.releasing)throw new AppError('网页入口正在维护，请稍后重试。',409);
    this.manager.mutations++;
    try{const result=await this.call('desktop-session.py',{action:'interrupt',threadId,turnId});if(result.result?.result?.goalPauseError)throw new AppError('轮次已停止，但目标暂停未确认：'+result.result.result.goalPauseError,409);return result;}
    finally{this.manager.mutations--;}
  }
  async candidates(search=''){return this.manager.passive('threads',{search});}
  async bind(threadId){
    if(!uuid.test(threadId||''))throw new AppError('请选择有效的桌面会话。');
    if(this.pending||this.unconfirmed())throw new AppError('请先核对尚未确认的发送结果。');
    if(this.manager.controlled.has(threadId)||this.manager.subscriptions.has(threadId)&&!this.manager.subscriptions.get(threadId)?.handoff)throw new AppError('该会话仍由网页引擎控制，请先交还桌面并在桌面打开。',409);
    this.pending=true;this.manager.mutations++;
    try{
    const {thread}=await this.manager.passive('detail',{threadId});
    if(thread.archived)throw new AppError('请先在桌面恢复此会话。');
    await this.call('desktop-session.py',{action:'probe',threadId});
    this.state.threadId=threadId;this.save();return {threadId};
    }finally{this.pending=false;this.manager.mutations--;}
  }
  unconfirmed(){return Object.entries(this.state.submissions).find(([,s])=>s.threadId===this.state.threadId&&['sending','unknown'].includes(s.status));}
  async detail(){
    const id=this.state.threadId;if(!id)throw new AppError('请先选择一条桌面管理会话。');
    const [{thread},history,probe]=await Promise.all([
      this.manager.passive('detail',{threadId:id}),this.manager.passive('history',{threadId:id,withOutputs:true}),
      this.call('desktop-session.py',{action:'probe',threadId:id}).catch(error=>({error:error.message}))
    ]);
    const turns=[...(history.data||[])].reverse();let changed=false;
    for(const turn of turns)for(const item of turn.items||[]){
      const saved=item.type==='userMessage'&&this.state.submissions[item.clientId];
      if(saved?.threadId===id&&saved.status!=='accepted'){saved.status='accepted';saved.turnId=turn.id;changed=true;}
    }
    if(changed)this.save();
    const available=!probe.error&&!thread.archived&&thread.activity?.state==='idle';
    return {thread:{...thread,status:{type:thread.activity?.state==='running'?'active':thread.activity?.state==='idle'?'idle':'unknown'}},
      turns,nextCursor:history.nextCursor,controlled:false,controlState:'desktop',historySource:'snapshot',
      desktop:{available:!probe.error,canSend:available,error:probe.error||null,unconfirmed:this.unconfirmed()?.[0]||null,settings:probe.settings?.settings||null,receipts:Object.fromEntries(Object.entries(this.state.submissions).filter(([,s])=>s.threadId===id).map(([key,s])=>[key,{status:s.status,turnId:s.turnId}]))},pendingRequests:[]};
  }
  async send({threadId,messageId,text}){
    if(threadId!==this.state.threadId||!uuid.test(messageId||'')||typeof text!=='string'||!text.trim()||text.length>100000)throw new AppError('发送内容或管理会话无效。');
    const hash=createHash('sha256').update(threadId+'\0'+text).digest('hex');
    const previous=this.state.submissions[messageId];
    if(previous){
      if(previous.hash!==hash)throw new AppError('同一发送标识不能用于不同消息。',409);
      if(previous.status==='accepted')return {accepted:true,turnId:previous.turnId,messageId};
      throw new AppError('这条消息的发送结果尚未确认，请先刷新并核对原始会话。',409,'OUTCOME_UNKNOWN');
    }
    if(this.pending||this.unconfirmed())throw new AppError('上一条消息仍在确认中。',409,'SEND_PENDING');
    if(this.manager.releasing||this.manager.controlled.has(threadId))throw new AppError('会话执行入口正在变化，请稍后重试。',409);
    this.pending=true;this.manager.mutations++;
    try{
      const detail=await this.detail();
      if(this.state.threadId!==threadId||!detail.desktop.canSend)throw new AppError(detail.desktop.error||'桌面会话未空闲或状态未确认，请稍后刷新。',409,'DESKTOP_BUSY');
      this.state.submissions[messageId]={threadId,hash,status:'sending',createdAt:Date.now()};this.save();
      try{
        const response=await this.call('desktop-session.py',{action:'send',threadId,messageId,text});
        const turnId=response.result?.result?.turn?.id;
        if(!turnId)throw new AppError('桌面回执格式变化，请核对原始会话。',409,'OUTCOME_UNKNOWN');
        this.state.submissions[messageId].status='accepted';this.state.submissions[messageId].turnId=turnId;this.save();
        return {accepted:true,turnId,messageId};
      }catch(error){this.state.submissions[messageId].status='unknown';this.save();throw error;}
    }finally{this.pending=false;this.manager.mutations--;}
  }
  async acknowledge({messageId,threadId}){
    if(this.pending||threadId!==this.state.threadId)throw new AppError('发送状态仍在变化。',409);
    const detail=await this.detail();
    if(!detail.desktop.canSend)throw new AppError('请先恢复桌面连接并等待空闲。',409);
    const item=this.state.submissions[messageId];
    if(item?.threadId===threadId&&item.status==='unknown'){item.status='reviewed';this.save();}
    return {ok:true};
  }
}
