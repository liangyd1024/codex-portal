import {randomUUID} from 'node:crypto';
import {AppError} from './core/errors.mjs';
import {messageInput} from './message-input.mjs';
import {turnOptions} from './composer.mjs';

// The engine owns storage, ordering and automatic dispatch. Only in-flight
// mutation/uncertain-delivery receipts live here; there is no local queue.
const operations=new WeakMap();
export async function queueInput(m,id,action,data={}) {
  m.requireLogin();m.assertControl(id);m.requireCapability('queueWrite');
  const rpc=m.rpc,generation=m.generation;
  let states=operations.get(rpc);if(!states){states=new Map();operations.set(rpc,states);}
  const key=JSON.stringify([id,data.queuedSubmissionId||'add']);
  if(states.get(key)==='pending')throw new AppError('正在确认此排队操作，请稍候。',409,'SEND_PENDING');
  if(states.get(key)==='unknown')throw new AppError('引导结果尚未确认，请核对原生会话，避免重复发送。',409,'OUTCOME_UNKNOWN');
  const cleanup=states.get(key)==='steered';states.set(key,'pending');
  let sent=false,steered=cleanup;
  const current=()=>{m.assertControl(id);if(m.rpc!==rpc||m.generation!==generation)throw new AppError('连接已变化，未执行排队操作。',409,'CONNECTION_CHANGED');};
  try{return await m.withMutation(async()=>{
    if(action==='add'){
      if(data.threads?.length)throw new AppError('排队暂不支持会话引用，请等待任务结束后发送。');
      const input=messageInput(data.text,data.images),options=await turnOptions(m,id,{skills:data.skills,plugins:data.plugins},{});current();
      sent=true;return await rpc.request('thread/queue/add',{threadId:id,input:[...input,...options.input],clientUserMessageId:randomUUID()});
    }
    if(typeof data.queuedSubmissionId!=='string'||!data.queuedSubmissionId||data.queuedSubmissionId.length>160)throw new AppError('排队消息标识无效。');
    const params={threadId:id,queuedSubmissionId:data.queuedSubmissionId};
    if(action==='delete'||cleanup){current();return await rpc.request('thread/queue/delete',params);}
    if(action!=='steer')throw new AppError('排队操作无效。');
    const {thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false});current();
    if(thread.status?.type!=='active'){sent=true;return await rpc.request('thread/queue/start',params);}
    let cursor,item;const visited=new Set();
    do {const page=await rpc.request('thread/queue/list',{threadId:id,limit:100,...(cursor?{cursor}:{})});current();item=page.data?.find(q=>q.id===data.queuedSubmissionId);cursor=page.nextCursor;if(cursor&&visited.has(cursor))throw new AppError('队列分页未推进，请刷新后重试。');visited.add(cursor);}while(!item&&cursor);
    if(!item)throw new AppError('此消息已离开队列，请刷新会话。',409,'QUEUE_CHANGED');
    const expectedTurnId=await m.activeTurn(id);current();sent=true;
    const result=await rpc.request('turn/steer',{threadId:id,expectedTurnId,input:item.input,clientUserMessageId:item.clientUserMessageId});
    steered=true;
    await rpc.request('thread/queue/delete',params);
    return result;
  },id);}catch(error){
    if(steered){states.set(key,'steered');throw new AppError('引导已发送，但队列清理尚未确认。重试只清理队列，不会再次引导。',502,'QUEUE_CLEANUP_PENDING');}
    if(sent&&(error.code==='RPC_TIMEOUT'||!rpc.connected)){if(action==='steer')states.set(key,'unknown');throw new AppError('发送结果未确认，请刷新核对，避免重复发送。',502,'OUTCOME_UNKNOWN');}
    throw error;
  }finally{if(states.get(key)==='pending')states.delete(key);}
}
