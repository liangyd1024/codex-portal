import {createHash} from 'node:crypto';
import {AppError,validateSelection} from './manager.mjs';
import {turnOptions} from './composer.mjs';

// Receipts prevent replay after a lost response. Execution remains native turn/start.
const receipts=new WeakMap();
export async function retryCapacity(m,id,{turnId,automatic=false,model,effort,mode}={}) {
  m.assertControl(id);m.requireCapability('capacityRetry');
  if(m.service.protocolValidation?.features?.capacityRetry?.supported!==true)throw new AppError('尚未核验此引擎的重试接口，请重新连接后再试。',409,'FEATURE_UNAVAILABLE');
  if(typeof turnId!=='string'||!turnId)throw new AppError('缺少失败轮次。');
  let entries=receipts.get(m);if(!entries){entries=new Map();receipts.set(m,entries);}
  const key=JSON.stringify([id,turnId]);
  if(entries.has(key))return entries.get(key);
  if(m.startingTurns.has(id))throw new AppError('已有请求正在确认，请稍候。',409);
  m.startingTurns.add(id);
  let sent=false;
  const rpc=m.rpc,generation=m.generation;
  const current=()=>{
    m.assertControl(id);
    if(m.rpc!==rpc||m.generation!==generation)throw new AppError('连接已变化，重试已取消。',409);
    if(m.activeTurns.has(id)||m.controlled.get(id)?.status?.type==='active')throw new AppError('会话已有新任务，重试已取消。',409);
    if([...m.requests.values()].some(r=>r.threadId===id))throw new AppError('请先处理会话中的待回答请求。',409);
  };
  const task=m.withMutation(async()=>{
    current();
    const {thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false});
    current();
    if(thread.status?.type!=='idle')throw new AppError('会话尚未空闲，重试已取消。',409);
    const page=await rpc.request('thread/turns/list',{threadId:id,limit:1,sortDirection:'desc',itemsView:'summary'});
    current();
    const last=page.data?.[0];
    if(last?.id!==turnId||last.status!=='failed'||last.error?.codexErrorInfo!=='serverOverloaded')throw new AppError('失败轮次已变化，请刷新会话。',409);
    const digest=createHash('sha256').update(key).digest('hex');
    const clientUserMessageId=[digest.slice(0,8),digest.slice(8,12),'5'+digest.slice(13,16),'a'+digest.slice(17,20),digest.slice(20,32)].join('-');
    const selection=validateSelection(m.models,model,effort);
    const options=await turnOptions(m,id,{access:'full',mode},selection);
    current();
    sent=true;
    const result=await rpc.request('turn/start',{threadId:id,input:[],clientUserMessageId,turnTrigger:automatic?'capacity_retry_automatic':'capacity_retry_manual',...selection,...options.params},{timeoutMs:60000});
    if(m.rpc===rpc&&m.generation===generation&&result.turn.status==='inProgress'&&m.finishedTurns.get(id)!==result.turn.id)m.activeTurns.set(id,result.turn.id);
    if(m.rpc===rpc&&m.generation===generation&&m.controlled.has(id))Object.assign(m.controlled.get(id),selection);
    return result;
  },id).catch(error=>{
    if(!sent)entries.delete(key);
    // Once dispatched, even a rejected/lost response requires history reconciliation.
    if(sent)throw new AppError('重试结果尚未确认，请刷新会话核对。不会自动重复提交。',502,'OUTCOME_UNKNOWN');
    throw error;
  }).finally(()=>m.startingTurns.delete(id));
  entries.set(key,task);
  return task;
}
