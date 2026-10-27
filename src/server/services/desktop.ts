import type {Manager} from '../../../lib/manager.mjs';
import type {NativeAutomations} from '../../../lib/native-automations.mjs';

// Values remain unvalidated here; native adapters retain their original rejection rules.
interface SendInput {threadId:unknown;messageId:unknown;text:unknown;[key:string]:unknown}
interface InterruptInput {threadId:unknown;turnId:unknown;[key:string]:unknown}
interface AcknowledgeInput {threadId:unknown;messageId:unknown;[key:string]:unknown}
export function createDesktopService(manager:Manager,automations:NativeAutomations,sessionFor:(id:string)=>NativeAutomations) {
 return {
  candidates:(search:string,cursor:string|null)=>manager.passive('threads',{search,cursor}),
  session(id:string) {
   const session=sessionFor(id);
   return {
    detail:()=>session.detail(),
    recover:()=>session.recover(),
    'question-answer':(data:any)=>session.answerQuestions({...data,threadId:id}),
    history:(cursor:string|null)=>session.history(cursor,id),
    message:(data:SendInput)=>session.send({...data,threadId:id}),
    interrupt:(data:InterruptInput)=>session.interrupt({...data,threadId:id}),
    acknowledge:(data:AcknowledgeInput)=>session.acknowledge({...data,threadId:id}),
   };
  },
  list:()=>automations.list(),
  automationCandidates:(search:string)=>automations.candidates(search),
  history:(cursor:string|null,id:string|null)=>automations.history(cursor,id),
  detail:()=>automations.detail(),
  actions:{
   binding:(data:{threadId:unknown})=>automations.bind(data.threadId),
   interrupt:(data:InterruptInput)=>automations.interrupt(data),
   message:(data:SendInput)=>automations.send(data),
   acknowledge:(data:AcknowledgeInput)=>automations.acknowledge(data),
  },
 };
}
