// A creation request may have reached the engine even when its response is lost.
export class NewChatDraft {
  storage:Pick<Storage,'getItem'|'setItem'>;key:string;cwd:string;phase:string;
  constructor(storage:NewChatDraft['storage'],key:string){this.storage=storage;this.key=key;this.cwd='';this.phase='editing';try{const saved=JSON.parse(storage.getItem(key)||'{}');this.cwd=typeof saved.cwd==='string'?saved.cwd:'';this.phase=['pending','uncertain'].includes(saved.phase)?'uncertain':'editing';}catch{}}
  save(){this.storage.setItem(this.key,JSON.stringify({cwd:this.cwd,phase:this.phase}));}
  begin(){if(this.phase!=='editing')throw Error('创建结果未确认，请先核对会话列表。');this.phase='pending';this.save();}
  failed(caught:unknown){const error=caught as {status?:number;code?:string};this.phase=!error.status||['CREATE_OUTCOME_UNKNOWN','OUTCOME_UNKNOWN'].includes(error.code!)?'uncertain':'editing';this.save();}
  complete(){this.phase='editing';this.save();}
}
