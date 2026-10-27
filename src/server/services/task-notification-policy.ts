import {taskNotice} from '../../../shared/connection-state.js';
interface Goal {createdAt:number;updatedAt?:number;objective?:string;status:string}
interface Params {threadId?:string;turn?:{id?:string;startedAt?:number;status?:string;items?:{type:string;[key:string]:unknown}[]};goal?:Goal|null;[key:string]:unknown}
interface Dependencies {
 context:()=>unknown;
 readGoal:(id:string)=>Promise<{goal:Goal|null}>;
 emit:(method:string,params:Params)=>void;
 onError?:(error:unknown)=>void;
}
/** Presentation policy only: native execution events and history remain intact. */
export class TaskNotificationPolicy {
 private context:unknown;
 private goals=new Map<string,Goal|null>();
 private turns=new Map<string,{id:string;goal:Goal|null;startedAt:number;ended?:boolean}>();
 private pending=new Map<string,Promise<void>>();
 private deps:Dependencies;
 constructor(deps:Dependencies){this.deps=deps;}
 prepare(method:string,params:Params):Params {
  const context=this.deps.context();
  if(context!==this.context){this.context=context;this.goals.clear();this.turns.clear();this.pending.clear();}
  const id=params.threadId;
  if(!id)return params;
  if(method==='thread/goal/updated'){
   this.goals.set(id,params.goal||null);
   const turn=this.turns.get(id);
   if(turn&&params.goal&&(!turn.ended&&params.goal.status==='active'||turn.goal?.createdAt===params.goal.createdAt))turn.goal=params.goal;
  }
  if(method==='thread/goal/cleared')this.goals.delete(id);
  if(method==='turn/started'&&params.turn?.id){
   const goal=this.goals.get(id);
   this.turns.set(id,{id:params.turn.id,goal:goal?.status==='active'?goal:null,startedAt:params.turn.startedAt??Date.now()/1000});
  }
  if(this.goals.size>1000)this.goals.delete(this.goals.keys().next().value!);
  if(this.turns.size>1000)this.turns.delete(this.turns.keys().next().value!);
  if(method!=='turn/completed'||!params.turn?.id||!['completed','failed','interrupted'].includes(params.turn.status||''))return params;
  const key=id+':'+params.turn.id;
  if(!this.pending.has(key)){
   const tracked=this.turns.get(id),associated=tracked?.id===params.turn.id?tracked:null;
   if(associated)associated.ended=true;
   const task=Promise.resolve().then(async()=>{
    let goal:Goal|null|undefined;
    try{const result=await this.deps.readGoal(id);goal=result.goal;}catch{}
    if(context!==this.deps.context())return;
    // A goal completed/cleared while its final turn was finishing still owns that turn.
    if(associated?.goal&&(!goal||goal.createdAt!==associated.goal.createdAt||(associated.goal.updatedAt??0)>(goal.updatedAt??0)))goal=associated.goal;
    // A later ordinary message must not inherit the previous completed goal.
    const startedAt=params.turn?.startedAt??associated?.startedAt;
    if(!associated?.goal&&goal?.status==='complete'&&typeof goal.updatedAt==='number'&&typeof startedAt==='number'&&goal.updatedAt<startedAt)goal=null;
    const notice={threadId:id,sourceMethod:method,notificationGoal:goal??null,notificationGoalKnown:goal!==undefined,
      turn:{id:params.turn?.id,status:params.turn?.status,items:params.turn?.items?.filter(item=>item.type==='agentMessage')}};
    // Do not duplicate tool outputs or silent intermediate turns over SSE.
    if(taskNotice('manager/notification',notice,{host:'',known:true}))this.deps.emit('manager/notification',notice);
   }).catch(error=>{try{this.deps.onError?.(error);}catch{}});
   this.pending.set(key,task);
   // Bound duplicate-event receipts; no timers or background polling.
   if(this.pending.size>1000)this.pending.delete(this.pending.keys().next().value!);
  }
  return {...params,notificationSuppressed:true};
 }
 async settled(){await Promise.all(this.pending.values());}
}
