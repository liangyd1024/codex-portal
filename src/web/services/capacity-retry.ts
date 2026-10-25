import type {NativeTurn} from '../../contracts/native';
export interface CapacityContext {host:string;id:string|null;turns:NativeTurn[];ready:boolean;unavailableReason?:string}
interface Entry {phase:string;deadline?:number;error?:string;errorCode?:string}
interface Failure {turnId?:string;delay:number|null}
export interface CapacityView {key:string;entry:Entry;failure:Failure;ready:boolean;seconds:number}
interface Options {context:()=>CapacityContext;send:(context:CapacityContext,turnId:string|undefined,automatic:boolean)=>Promise<unknown>;changed?:(view:CapacityView|null)=>void;now?:()=>number;storage?:Pick<Storage,'getItem'|'setItem'>}
export interface InstallOptions extends Options {container:HTMLElement;refresh?:()=>Promise<unknown>}
export const CAPACITY_DELAYS=[10,30,120,300];
export function capacityFailure(turns:NativeTurn[]=[]):Failure|null {
  const last=turns.at(-1);
  if(last?.status!=='failed'||(last.error as {codexErrorInfo?:string}|undefined)?.codexErrorInfo!=='serverOverloaded')return null;
  let attempt=0;
  for(let i=turns.length-1;i>0;i--){
    const current=turns[i],prior=turns[i-1];
    if(current.items?.some(item=>item.type==='userMessage')||prior.status!=='failed'||(prior.error as {codexErrorInfo?:string}|undefined)?.codexErrorInfo!=='serverOverloaded')break;
    attempt++;
  }
  return {turnId:last.id,delay:CAPACITY_DELAYS[attempt]??null};
}
export class CapacityRetry {
  context:Options['context'];send:Options['send'];changed:NonNullable<Options['changed']>;now:()=>number;storage:Options['storage'];entries:Map<string,Entry>;key:string|null;
  constructor({context,send,changed=()=>{},now=Date.now,storage}:Options){this.context=context;this.send=send;this.changed=changed;this.now=now;this.storage=storage;this.entries=new Map();this.key=null;}
  save(key:string,entry:Entry){this.entries.set(key,entry);try{this.storage?.setItem('rcm.capacity.'+key,JSON.stringify(entry));}catch{}}
  sync():CapacityView|null{
    const c=this.context(),failure=capacityFailure(c.turns),key=failure?JSON.stringify([c.host,c.id,failure.turnId]):null;
    if(this.key&&this.key!==key){const old=this.entries.get(this.key);if(old?.phase==='waiting'){old.phase='paused';this.save(this.key,old);}}
    this.key=key;if(!key||!failure)return null;
    let entry=this.entries.get(key);
    if(!entry&&!c.ready)return {key,entry:{phase:'blocked'},failure,ready:false,seconds:0};
    if(!entry){try{entry=JSON.parse(this.storage?.getItem('rcm.capacity.'+key)||'null');}catch{}
      if(entry?.phase==='sending')entry.phase='uncertain';
      entry??={phase:failure.delay==null?'paused':'waiting',deadline:this.now()+(failure.delay??0)*1000};this.save(key,entry);
    }
    if(!c.ready&&entry.phase==='waiting'){entry.phase='paused';this.save(key,entry);}
    return {key,entry,failure,ready:c.ready,seconds:Math.max(0,Math.ceil((entry.deadline!-this.now())/1000))};
  }
  tick(){const v=this.sync();this.changed(v);if(v?.ready&&v.entry.phase==='waiting'&&v.seconds===0)void this.retry(true);}
  cancel(){const v=this.sync();if(v){v.entry.phase='paused';this.save(v.key,v.entry);this.changed(this.sync());}}
  async retry(automatic=false){
    const v=this.sync();if(!v?.ready||['sending','sent','uncertain'].includes(v.entry.phase)||automatic&&v.entry.phase!=='waiting')return;
    const c=this.context();v.entry.phase='sending';delete v.entry.error;delete v.entry.errorCode;this.save(v.key,v.entry);this.changed(this.sync());
    try{await this.send(c,v.failure.turnId,automatic);v.entry.phase='sent';}
    catch(caught){const error=caught as {code?:string;status?:number;message:string};v.entry.phase=error.code==='OUTCOME_UNKNOWN'||!error.status?'uncertain':'paused';v.entry.error=error.message;v.entry.errorCode=error.code;}
    this.save(v.key,v.entry);this.changed(this.sync());
  }
}

let installView:((options:InstallOptions)=>CapacityRetry)|undefined;
export function configureCapacityRetryView(install:NonNullable<typeof installView>){installView=install;}
export function installCapacityRetry(options:InstallOptions){if(!installView)throw Error('容量重试视图未安装。');return installView(options);}
