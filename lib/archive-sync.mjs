import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';

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
  settle(id){this.writing.delete(id);}
  cancel(id){this.writing.delete(id);this.pending.delete(id);this.save();}
  async deliver(id,accountScope){
    if(this.delivering.has(id))return this.delivering.get(id);
    const entry=this.pending.get(id);
    if(!entry||entry.accountScope!==accountScope||this.writing.has(id))return false;
    const work=(async()=>{
      const {thread}=await this.manager.passive('detail',{threadId:id});
      if(this.pending.get(id)!==entry||thread?.archived!==entry.archived)return false;
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
