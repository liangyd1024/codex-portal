import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';
import {AppError} from './core/errors.mjs';

// Persist notification intent, never an engine write to replay. A timeout may
// precede the state-db commit, and IPC can fail after that commit succeeds.
export class ArchiveSync {
  constructor(manager,file=null){
    this.manager=manager;this.file=file;this.pending=new Map();this.writing=new Set();this.delivering=new Map();
    if(file){try{this.pending=new Map(JSON.parse(readFileSync(file,'utf8')));}catch(error){if(error.code!=='ENOENT')manager.record?.(error,'读取归档同步状态');}}
  }
  save(){
    if(!this.file)return;
    mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    writeFileSync(this.file+'.tmp',JSON.stringify([...this.pending]),{mode:0o600});
    renameSync(this.file+'.tmp',this.file);
  }
  start(id,archived,accountScope){
    this.pending.set(id,{archived,accountScope});this.save();this.writing.add(id);
  }
  confirm(id){
    const entry=this.pending.get(id);if(!entry)return;entry.confirmed=true;
    // A local cache failure cannot turn an acknowledged native write into a
    // rejection. On restart the old unknown intent is conservatively rechecked.
    try{this.save();}catch(error){this.manager.record?.(error,'保存归档确认状态');}
  }
  async prepare(id,archived,accountScope){
    // Serialize a previous notification with its inverse. Never replay an
    // unknown write, including after a Portal restart or a second browser click.
    await this.delivering.get(id)?.catch(()=>{});
    const entry=this.pending.get(id);
    if(!entry)return false;
    if(entry.accountScope!==accountScope)throw new AppError('账号已变化，请刷新后核对归档状态。',409,'ACCOUNT_CHANGED');
    if(this.writing.has(id))throw new AppError('此会话的归档操作仍在处理中。',409,'SIDEBAR_BUSY');
    const {thread}=await this.manager.passive('detail',{threadId:id});
    if(!entry.confirmed&&thread?.archived!==entry.archived)throw new AppError('上一次归档或撤销归档的结果仍待确认，请刷新或在原入口核对；未重复发送操作。',409,'OUTCOME_UNKNOWN');
    if(thread?.archived===entry.archived)this.confirm(id);
    return thread?.archived===archived;
  }
  settle(id){this.writing.delete(id);}
  cancel(id){this.writing.delete(id);this.pending.delete(id);this.save();}
  async deliver(id,accountScope){
    if(this.delivering.has(id))return this.delivering.get(id);
    const entry=this.pending.get(id);
    if(!entry||entry.accountScope!==accountScope||this.writing.has(id))return false;
    const work=(async()=>{
      const rpc=this.manager.rpc,generation=this.manager.generation,accountRevision=this.manager.accountRevision;
      const {thread}=await this.manager.passive('detail',{threadId:id});
      if(this.pending.get(id)!==entry||this.writing.has(id)||thread?.archived!==entry.archived||this.manager.rpc!==rpc||this.manager.generation!==generation||this.manager.accountRevision!==accountRevision)return false;
      this.confirm(id);
      await this.manager.notifyDesktopArchive(id,entry.archived);
      if(this.pending.get(id)!==entry)return false;
      if(entry.archived){this.manager.controlled.delete(id);this.manager.subscriptions.delete(id);this.manager.saveSubscriptions();}
      this.pending.delete(id);this.save();
      this.manager.publish('manager/sidebarChanged',{action:entry.archived?'archive':'restore',threadId:id});
      return true;
    })();
    this.delivering.set(id,work);
    try{return await work;}finally{this.delivering.delete(id);}
  }
  async flush(accountScope){
    // A disconnected desktop must not prevent reading the sidebar. Retain each
    // failed intent for the next refresh/reconnect, including after web restart.
    await Promise.allSettled([...this.pending].filter(([,entry])=>entry.accountScope===accountScope).slice(0,10).map(([id])=>this.deliver(id,accountScope)));
  }
}
