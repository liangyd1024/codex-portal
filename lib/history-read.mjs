import {AppError} from './core/errors.mjs';

// Snapshot ordinals and native cursors are different pagination contracts.
const nativePrefix='native:';
const cursorChanged=()=>new AppError('历史读取方式已变化。请刷新会话，再加载更早记录。',409,'HISTORY_CURSOR_CHANGED');

export async function readHistory(manager,payload) {
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>{
    if(manager.rpc!==rpc||manager.generation!==generation||!rpc?.connected)
      throw new AppError('连接已变化。请重新读取会话。',409,'CONNECTION_CHANGED');
  };
  const cursor=payload.cursor;
  const nativeCursor=typeof cursor==='string'&&cursor.startsWith(nativePrefix);
  if(!nativeCursor){
    try{
      const result=await manager.passive('history',payload);
      current();return result;
    }catch(error){
      current();
      if(!/unable to open database file/i.test(error.message))throw error;
      if(cursor)throw cursorChanged();
      if(manager.service.protocolValidation?.unsupportedMethods?.includes('thread/turns/list'))throw error;
    }
  }
  if(nativeCursor&&!cursor.slice(nativePrefix.length))throw cursorChanged();
  if(manager.service.protocolValidation?.unsupportedMethods?.includes('thread/turns/list'))
    throw new AppError('当前目标引擎不支持原生历史读取。',409,'FEATURE_UNAVAILABLE');
  // This read neither subscribes to nor resumes the thread. Do not repair
  // native SQLite files or replay mutations to make a snapshot readable.
  const page=await rpc.request('thread/turns/list',{
    threadId:payload.threadId,limit:payload.preview?1:5,sortDirection:'desc',itemsView:'full',
    ...(nativeCursor?{cursor:cursor.slice(nativePrefix.length)}:{}),
  },{timeoutMs:30000});
  current();
  if(!Array.isArray(page?.data)||page.data.some(turn=>!turn||typeof turn.id!=='string'||!Array.isArray(turn.items))||
    (page.nextCursor!=null&&typeof page.nextCursor!=='string'))
    throw new AppError('原生历史返回格式无效。',502,'INVALID_HISTORY');
  if(payload.preview)for(const turn of page.data)for(const item of turn.items){
    if(item.type==='commandExecution'&&typeof item.aggregatedOutput==='string'){
      item.aggregatedOutput=item.aggregatedOutput.slice(0,16384);item.outputPartial=true;
    }
  }
  // Preserve the existing incremental command-output contract when native
  // history is used instead of SQLite. This is RCM's own output journal.
  if(payload.withOutputs){
    const outputs=await manager.passive('outputs',{...payload,turnIds:page.data.map(turn=>turn.id)});
    current();
    for(const entry of outputs.data||[]){
      const turn=page.data.find(turn=>turn.id===entry.turnId);if(!turn)continue;
      const old=turn.items.find(item=>item.id===entry.item.id);
      if(old){delete old.aggregatedOutput;Object.assign(old,entry.item);}
      else turn.items.push(entry.item);
    }
  }
  return {...page,nextCursor:page.nextCursor?nativePrefix+page.nextCursor:null,historySource:'protocol'};
}
