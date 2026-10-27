import {AppError} from './core/errors.mjs';

// A user supplement is accepted before resuming: setting an idle goal active first
// would start an automatic turn before its missing information had arrived.
export async function sendWithGoalResume(m,id,data,send){
 const expected=data.resumeBlockedGoal;
 if(expected===undefined)return send();
 if(!expected||typeof expected.objective!=='string'||!Number.isFinite(expected.createdAt)||data.mode==='plan')throw new AppError('目标恢复参数无效。');
 m.assertControl(id);m.requireCapability('goal');
 const rpc=m.rpc,generation=m.generation;
 const result=await send();
 // A resume failure must never make an accepted message look unsent.
 try{
  return await m.withMutation(async()=>{
   const current=()=>{m.assertControl(id);if(m.rpc!==rpc||m.generation!==generation)throw Error('连接已变化，请核对目标状态。');};
   current();const {goal}=await rpc.request('thread/goal/get',{threadId:id},{timeoutMs:3000});current();
   if(!goal||goal.status!=='blocked'||goal.createdAt!==expected.createdAt||goal.objective!==expected.objective)return result;
   const origin=m.service.protocolValidation?.optionalParams?.['thread/goal/set']?.origin===false?{}:{origin:'user'};
   const resumed=await rpc.request('thread/goal/set',{threadId:id,status:'active',...origin},{timeoutMs:10000});current();
   return {...result,goalResume:resumed.goal};
  },id);
 }catch(error){return {...result,goalResumeError:'消息已发送，目标恢复未确认：'+error.message};}
}
