import {readFile} from 'node:fs/promises';
import {AppError} from './core/errors.mjs';

export async function desktopAvailable(manager) {
  if(manager.host.kind!=='local')return false;
  const script=await readFile(new URL('../scripts/desktop-session.py',import.meta.url),'utf8');
  const result=await manager.remote(`PAYLOAD={'action':'availability'}\n${script}`,{timeoutMs:5000});
  if(result.failure)throw new AppError(result.failure.message,503,result.failure.code);
  if(typeof result.available!=='boolean')throw new AppError('无法确认桌面执行入口，草稿已保留。',503,'DESKTOP_UNAVAILABLE');
  return result.available===true;
}

// Only subscriptions move. Never stop a running turn, restart an engine, or
// replay a message while changing entrances.
export async function releaseForDesktop(manager,id,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),unloadDelaySecs=manager.service.threadUnloadDelaySecs}={}) {
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>manager.rpc===rpc&&manager.generation===generation&&rpc?.connected;
  const released=()=>manager.subscriptions.get(id)?.handoff?.state==='released';
  await manager.handoff(id);
  if(released())return;
  const delay=unloadDelaySecs;
  // Long native retention policies remain visible as a pending handoff.
  if(!Number.isFinite(delay)||delay>10)throw new AppError('会话已创建，正在等待原生引擎释放。请在释放后恢复桌面连接，草稿已保留。',409,'HANDOFF_PENDING');
  for(const ms of [Math.max(250,delay*1000+250),1000,2000]){
    await wait(ms);
    if(!current())throw new AppError('连接已变化，请恢复连接后核对交接状态。草稿已保留。',409,'CONNECTION_CHANGED');
    if(!released())await manager.handoffs.refresh();
    if(released())return;
  }
  throw new AppError('原生引擎尚未释放会话，请稍后重试交还。草稿已保留。',409,'HANDOFF_PENDING');
}

export async function createWithDesktop(manager,input,sessionFor,{available=desktopAvailable,release=releaseForDesktop}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))return manager.newThread(input);
  const {preferDesktop,...webParams}=input;
  const {name,...params}=webParams;
  if(preferDesktop!==undefined&&typeof preferDesktop!=='boolean')throw new AppError('会话执行入口参数无效。');
  if(!preferDesktop||!sessionFor||manager.host.kind!=='local'||manager.service.protocolValidation?.features?.handoff?.supported!==true)return manager.newThread(webParams);
  // Fallback is allowed only before creation. A failed probe does not establish
  // that the desktop is absent, so keep the draft instead of changing engines.
  if(!await available(manager))return manager.newThread(webParams);
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>manager.rpc===rpc&&manager.generation===generation&&rpc?.connected;
  let created;
  manager.mutations++;
  try {
    created=await manager.newThread(params,{desktop:true});
    const id=created.thread.id;
    if(name?.trim()){
      await rpc.request('thread/name/set',{threadId:id,name:name.trim().slice(0,200)});
      created.thread={...created.thread,name:name.trim().slice(0,200)};
    }
    if(!current())throw new AppError('连接已变化，请核对已创建的会话。',409,'CONNECTION_CHANGED');
    await release(manager,id,{unloadDelaySecs:0});
    manager.pendingDiscovery?.delete(id);
    if(!current())throw new AppError('连接已变化，请恢复连接后继续。',409,'CONNECTION_CHANGED');
    const session=sessionFor(id);
    let detail=await session.recover();
    if(!detail.desktop?.canSend)throw new AppError(detail.desktop?.error||'桌面尚未准备好，草稿已保留。',409,'DESKTOP_UNAVAILABLE');
    const settings=detail.desktop.settings;
    if(params.model&&settings?.model&&(settings.model!==params.model||params.effort&&settings.reasoningEffort!==params.effort)){
      const effort=params.effort||settings.reasoningEffort||manager.models.find(model=>model.model===params.model||model.id===params.model)?.defaultReasoningEffort;
      await session.updateSettings({threadId:id,model:params.model,effort,expected:settings});
      detail=await session.detail();
    }
    if(!current())throw new AppError('连接已变化，请核对会话入口后发送。',409,'CONNECTION_CHANGED');
    return {...detail,creationReady:detail.desktop?.canSend===true};
  } catch(error) {
    if(!created)throw error;
    // Creation succeeded. Return its identity even when handoff failed, so the
    // browser keeps the draft on this thread and cannot create a duplicate.
    const id=created.thread.id,handoff=manager.handoffs.entries().find(item=>item.threadId===id)||null;
    manager.record(error,'准备桌面执行入口',{diagnosticOnly:true});
    const desktop=handoff?.state==='released';
    return {...created,thread:{...created.thread,status:{type:'unknown'}},controlled:!desktop&&manager.controlled.has(id),
      creationReady:false,creationError:error.message,handoff,controlState:desktop?'desktop':'viewing',
      ...(desktop?{desktop:{available:false,canSend:false,error:error.message,errorCode:error.code}}:{})};
  } finally {manager.mutations--;}
}
