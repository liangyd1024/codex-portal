import {shareRead} from './core/pending-read.mjs';

const readers=new WeakMap();
// This queue limits read-only status work; it never schedules Codex execution.
function limited(manager,work){
  let pool=readers.get(manager);
  if(!pool){pool={active:0,waiting:[]};readers.set(manager,pool);}
  return new Promise((resolve,reject)=>{
    const run=()=>{pool.active++;Promise.resolve().then(work).then(resolve,reject).finally(()=>{pool.active--;pool.waiting.shift()?.();});};
    if(pool.active<4)run();else pool.waiting.push(run);
  });
}
export function refreshThreadStatuses(manager,ids){
  const rpc=manager.rpc,generation=manager.generation,accountRevision=manager.accountRevision||0;
  const connected=()=>manager.rpc===rpc&&manager.generation===generation&&(manager.accountRevision||0)===accountRevision&&rpc?.connected&&manager.connection.state==='connected';
  const eligible=id=>manager.controlled.has(id)&&!manager.subscriptions.get(id)?.handoff&&['active','unknown'].includes(manager.controlled.get(id).status?.type||'unknown');
  return Promise.all([...new Set(ids)].filter(eligible).map(id=>shareRead(manager,JSON.stringify(['liveThreadStatus',generation,accountRevision,id]),()=>limited(manager,async()=>{
    if(!connected()||!eligible(id))return;
    const known=manager.controlled.get(id),status=known.status;
    let next,error=null;
    try{
      if(manager.service.protocolValidation?.unsupportedMethods?.includes('thread/read'))throw Error('当前引擎不支持读取会话状态。');
      const result=await rpc.request('thread/read',{threadId:id,includeTurns:false},{timeoutMs:30000});
      if(result.thread?.id!==id||typeof result.thread?.status?.type!=='string')throw Error('引擎未返回有效会话状态。');
      next=result.thread.status;
    }catch(e){next={type:'unknown'};error=e.message||String(e);}
    // Never override a notification, handoff, account change or a new engine.
    if(!connected()||manager.controlled.get(id)!==known||known.status!==status||manager.subscriptions.get(id)?.handoff)return;
    if(JSON.stringify(known.status)===JSON.stringify(next)&&known.statusReadError===error)return;
    known.status=next;known.statusReadError=error;
    manager.publish('manager/status',manager.status());
  }))));
}
