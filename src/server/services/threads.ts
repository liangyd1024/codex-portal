import type {Manager} from '../../../lib/manager.mjs';
import {queueInput} from '../../../lib/queued-inputs.mjs';
import {createSideChat,readSideChat,notificationThreadTarget} from '../../../lib/side-chats.mjs';
import {retryCapacity} from '../../../lib/capacity-retry.mjs';
import {sendWithGoalResume} from '../../../lib/goal-follow-up.mjs';
import {setGoal} from '../../../lib/composer.mjs';

type NativePayload=Parameters<Manager['newThread']>[0];
export function createThreadService(manager:Manager) {
 return {
  list:(options:Parameters<Manager['threads']>[0])=>manager.threads(options),
  detail:(...args:Parameters<Manager['detail']>)=>manager.detail(...args),
  history:(...args:Parameters<Manager['history']>)=>manager.history(...args),
  turnDirectory:(id:string)=>manager.turnDirectory(id),
  notificationTarget:(id:string)=>notificationThreadTarget(manager,id),
  sideChat:(id:string)=>readSideChat(manager,id),
  create:(data:NativePayload)=>manager.newThread(data),
  actions:{
   'queue-update':(id:string,data:NativePayload)=>queueInput(manager,id,'update',data),
   'queue-add':(id:string,data:NativePayload)=>sendWithGoalResume(manager,id,data,()=>queueInput(manager,id,'add',data)),
   'queue-steer':(id:string,data:NativePayload)=>queueInput(manager,id,'steer',data),
   'queue-delete':(id:string,data:NativePayload)=>queueInput(manager,id,'delete',data),
   'side-chat':(id:string,data:NativePayload)=>createSideChat(manager,id,data),
   'retry-capacity':(id:string,data:NativePayload)=>retryCapacity(manager,id,data),
   'question-answer':(id:string,data:NativePayload)=>manager.answerQuestions(id,data),
   goal:(id:string,data:NativePayload)=>setGoal(manager,id,data),
   takeover:(id:string,_data:NativePayload)=>manager.takeover(id),
   handoff:(id:string,_data:NativePayload)=>manager.handoff(id),
   message:(id:string,data:NativePayload)=>sendWithGoalResume(manager,id,data,()=>manager.message(id,data)),
   steer:(id:string,data:NativePayload)=>sendWithGoalResume(manager,id,data,()=>manager.steer(id,data)),
   interrupt:(id:string,_data:NativePayload)=>manager.interrupt(id),
  },
 };
}
