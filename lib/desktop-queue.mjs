import {AppError} from './core/errors.mjs';

// This is the native cross-process queue, not a Portal scheduler. Queue reads
// and writes never resume a thread or acquire its engine ownership.
export async function readDesktopQueue(session,id) {
 const m=session.manager;
 if(!m.rpc?.connected||m.service?.protocolValidation?.features?.queueWrite?.supported!==true)return {data:[],error:'当前连接尚未确认原生队列能力。'};
 try {
  const data=[],visited=new Set();let cursor;
  do {
   const page=await m.rpc.request('thread/queue/list',{threadId:id,limit:100,...(cursor?{cursor}:{})});
   if(!Array.isArray(page.data))throw Error('原生队列格式未确认。');
   data.push(...page.data);cursor=page.nextCursor;
   if(cursor&&(visited.has(cursor)||visited.size>=20))throw Error('队列读取未完成，请稍后重试。');visited.add(cursor);
  }while(cursor);
  return {data};
 }catch(error){return {data:[],error:error.message};}
}
export async function desktopQueueAction(s,action,{queuedSubmissionId,text,expectedText}={}) {
 const m=s.manager,id=s.state.threadId;
 if(!['delete','steer','update'].includes(action)||typeof queuedSubmissionId!=='string'||!queuedSubmissionId||queuedSubmissionId.length>160)throw new AppError('排队操作无效。');
 if(s.pending||s.unconfirmed())throw new AppError('上一条操作仍在确认中。',409,'SEND_PENDING');
 m.requireLogin();m.requireCapability(action==='update'?'queueEdit':'queueWrite');
 if(m.releasing||m.controlled.has(id))throw new AppError('会话入口正在变化，请稍后重试。',409);
 const rpc=m.rpc,generation=m.generation;
 const current=()=>{if(m.rpc!==rpc||m.generation!==generation||m.releasing||m.controlled.has(id))throw new AppError('连接已变化，未执行队列操作。',409,'CONNECTION_CHANGED');};
 s.pending=true;m.mutations++;
 try {
  const detail=await s.detail();current();
  if(!detail.desktop.canSend||detail.queue.error)throw new AppError(detail.desktop.error||detail.queue.error||'桌面暂不可用。',409);
  const item=detail.queue.data.find(q=>q.id===queuedSubmissionId);
  if(!item)throw new AppError('消息已离开队列，请刷新会话。',409,'QUEUE_CHANGED');
  const params={threadId:id,queuedSubmissionId};
  if(action==='delete')return await rpc.request('thread/queue/delete',params);
  if(action==='update'){
   const before=item.input.filter(p=>p.type==='text').map(p=>p.text).join('\n');
   if(typeof text!=='string'||text.length>100000||expectedText!==before)throw new AppError('消息已变化，请重新读取后编辑。',409,'QUEUE_CHANGED');
   const input=[...(text.trim()?[{type:'text',text}]:[]),...item.input.filter(p=>p.type!=='text')];
   if(!input.length)throw new AppError('请输入消息内容。');
   return await rpc.request('thread/queue/update',{...params,input});
  }
  // Remove atomically before steering so native automatic dispatch cannot also
  // consume this entry. A false deletion means it was already taken elsewhere.
  if(detail.thread.status.type!=='active')throw new AppError('当前轮次已结束，原生队列将自动发送。请刷新会话。',409,'QUEUE_CHANGED');
  const messageId=item.clientUserMessageId;
  if(!/^[0-9a-f-]{36}$/i.test(messageId||''))throw new AppError('原生消息标识未确认，未执行引导。',409);
  const previous=s.state.submissions[messageId];
  const receipt={...previous,threadId:id,status:'sending',delivery:'steer',queuedSubmission:item,createdAt:Date.now()};
  s.state.submissions[messageId]=receipt;s.save();
  let removed=false;
  try {
   const result=await rpc.request('thread/queue/delete',params);
   if(result.deleted!==true){if(previous)s.state.submissions[messageId]=previous;else delete s.state.submissions[messageId];s.save();throw new AppError('消息已离开队列，未重复引导。',409,'QUEUE_CHANGED');}
   removed=true;current();
   const response=await s.call('desktop-session.py',{action:'send',threadId:id,messageId,steer:true,cwd:detail.thread.cwd,input:item.input,text:item.input.filter(p=>p.type==='text').map(p=>p.text).join('\n')});
   const turnId=response.result?.result?.turnId||response.result?.result?.turn?.id;
   if(!turnId)throw new AppError('引导结果未确认，请核对原生会话。',409,'OUTCOME_UNKNOWN');
   Object.assign(receipt,{status:'accepted',turnId,queuedSubmission:{id:item.id}});s.save();return {accepted:true,turnId,delivery:'steer'};
  }catch(error){
   if(error.code==='QUEUE_CHANGED')throw error;
   // Only definite non-delivery permits restoring the native queued entry.
   if(removed&&['DESKTOP_NOT_SENT','DESKTOP_UNAVAILABLE','INVALID_REQUEST','CONNECTION_CHANGED'].includes(error.code)&&m.rpc===rpc&&m.generation===generation){
    try{await rpc.request('thread/queue/add',{threadId:id,input:item.input,clientUserMessageId:messageId});receipt.status='accepted';receipt.delivery='queue';s.save();throw error;}
    catch(restoreError){if(restoreError===error)throw error;}
   }
   receipt.status='unknown';s.save();throw new AppError('排队消息的引导结果未确认，请核对原始会话，避免重复发送。',502,'OUTCOME_UNKNOWN');
  }
 }finally{s.pending=false;m.mutations--;}
}
