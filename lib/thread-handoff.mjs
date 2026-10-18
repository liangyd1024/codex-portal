// Ending this entrance's subscription never interrupts a turn or stops a service.
// Persist the user's intent in the subscription record before sending unsubscribe.
export class ThreadHandoffs {
  constructor(manager, ErrorClass) {
    this.manager=manager;this.ErrorClass=ErrorClass;this.checking=new Set();this.refreshing=null;this.timer=null;
  }
  fail(message,code='HANDOFF_UNCONFIRMED',status=409,details) {throw new this.ErrorClass(message,status,code,details);}
  entries() {
    const result=new Map([...this.manager.subscriptions].filter(([,v])=>v.handoff).map(([id,v])=>[id,{threadId:id,...v.handoff}]));
    for(const id of this.checking)result.set(id,{threadId:id,...result.get(id),state:'checking'});
    return [...result.values()];
  }
  assertAvailable(id) {
    if(this.checking.has(id))this.fail('正在交还此会话，请等待检查结束。','HANDOFF_PENDING');
  }
  save(id,state,reason=null) {
    const m=this.manager,previous=m.subscriptions.get(id);
    const entry={...previous,handoff:{requestedAt:previous?.handoff?.requestedAt||Date.now(),state,reason}};
    m.subscriptions.set(id,entry);
    try {m.saveSubscriptions();}catch(error){if(previous)m.subscriptions.set(id,previous);else m.subscriptions.delete(id);throw error;}
    m.controlled.delete(id);m.activeTurns.delete(id);m.conflicts.delete(id);
    m.publish('manager/status',m.status());
  }
  connection(rpc,generation) {
    const m=this.manager;
    if(m.rpc!==rpc||m.generation!==generation||!rpc.connected)this.fail('连接已变化，交还结果尚未确认。重连后可重新检查。','CONNECTION_CHANGED');
  }
  async loaded(rpc) {
    const ids=new Set(),seen=new Set();let cursor;
    do {
      const page=await rpc.request('thread/loaded/list',cursor?{cursor}:{},{timeoutMs:5000});
      if(!Array.isArray(page.data)||page.data.some(id=>typeof id!=='string'))this.fail('无法确认引擎中的会话状态，请重试。');
      for(const id of page.data)ids.add(id);
      cursor=page.nextCursor;
      if(cursor&&(typeof cursor!=='string'||seen.has(cursor)))this.fail('会话列表分页异常，暂不能确认释放结果。');
      if(cursor)seen.add(cursor);
    }while(cursor);
    return ids;
  }
  localBlockers(id) {
    const m=this.manager,reasons=[];
    if(m.startingTurns.has(id)||m.threadMutations.get(id))reasons.push('有会话操作尚未完成');
    if(m.activeTurns.has(id))reasons.push('当前轮次仍在运行');
    if([...m.requests.values()].some(r=>!r.threadId||r.threadId===id))reasons.push('有待处理的审批或输入请求');
    return reasons;
  }
  async end(id) {
    const m=this.manager;m.requireWritable();
    if(m.service.protocolValidation?.features?.handoff?.supported!==true)this.fail('当前引擎尚未核验单会话交还能力，请重新连接后检查。','FEATURE_UNAVAILABLE');
    this.assertAvailable(id);
    if(!m.controlled.has(id)&&!m.subscriptions.get(id)?.handoff)this.fail('当前入口没有接管此会话。','NOT_CONTROLLED');
    const blockers=this.localBlockers(id);
    if(blockers.length)this.fail('暂不能交还：'+blockers.join('；')+'。','THREAD_BUSY');
    this.checking.add(id);m.publish('manager/status',m.status());
    try {return await m.withMutation(async()=>{
      const rpc=m.rpc,generation=m.generation;
      const loaded=await this.loaded(rpc);this.connection(rpc,generation);
      if(!loaded.has(id)){this.save(id,'released');return {...m.subscriptions.get(id).handoff,threadId:id};}
      const [{thread},goal,terminals,queued]=await Promise.all([
        rpc.request('thread/read',{threadId:id,includeTurns:false},{timeoutMs:5000}),
        rpc.request('thread/goal/get',{threadId:id},{timeoutMs:5000}).catch(error=>{
          if(/^ephemeral thread does not support goals(?::|$)/i.test(error.message))return {goal:null};throw error;
        }),
        rpc.request('thread/backgroundTerminals/list',{threadId:id,limit:100},{timeoutMs:5000}),
        rpc.request('thread/queue/list',{threadId:id,limit:1},{timeoutMs:5000}),
      ]);
      this.connection(rpc,generation);
      if(!['idle','active'].includes(thread?.status?.type)||!Object.hasOwn(goal||{},'goal')||
        (goal?.goal!==null&&!['active','complete','paused','blocked','budgetLimited','usageLimited'].includes(goal?.goal?.status))||
        !Array.isArray(terminals?.data)||!Array.isArray(queued?.data))this.fail('无法确认会话、目标或后台任务状态，请刷新后重试。');
      const reasons=this.localBlockers(id);
      if(thread.status.type==='active')reasons.push('会话正在执行或等待输入');
      if(goal.goal?.status==='active')reasons.push('目标模式仍在运行');
      if(terminals.data.length||terminals.nextCursor)reasons.push('后台命令仍在运行');
      if(queued.data.length||queued.nextCursor)reasons.push('还有排队输入');
      if(reasons.length)this.fail('暂不能交还：'+[...new Set(reasons)].join('；')+'。','THREAD_BUSY');
      // This durable tombstone also protects a crash or a lost RPC response.
      this.save(id,'unknown','正在确认退订结果');
      try {
        const result=await rpc.request('thread/unsubscribe',{threadId:id},{timeoutMs:10000});
        this.connection(rpc,generation);
        if(!['unsubscribed','notSubscribed','notLoaded'].includes(result.status))this.fail('引擎未返回可确认的退订结果。');
        // "unsubscribed" is not proof that the engine released the writer.
        const current=await this.loaded(rpc);this.connection(rpc,generation);
        this.save(id,current.has(id)?'waiting':'released');
      }catch(error){
        this.save(id,'unknown','退订或释放结果未确认，请重新检查。');
        throw new this.ErrorClass('交还结果未确认；此入口已停止自动接管。请恢复连接后重新检查。',502,'HANDOFF_UNCONFIRMED');
      }
      return {...m.subscriptions.get(id).handoff,threadId:id};
    });}finally{
      this.checking.delete(id);m.publish('manager/status',m.status());this.start();
    }
  }
  closed(id) {
    if(!this.manager.subscriptions.get(id)?.handoff)return;
    try{this.save(id,'released');}catch(error){this.manager.record(error,'保存交还状态');}
  }
  async refresh() {
    if(this.refreshing)return this.refreshing;
    const m=this.manager,rpc=m.rpc,generation=m.generation;
    if(!rpc?.connected||m.connection.state!=='connected')return;
    const pending=[...m.subscriptions].filter(([,v])=>v.handoff&&v.handoff.state!=='released');
    if(!pending.length)return;
    const task=(async()=>{
      const loaded=await this.loaded(rpc);this.connection(rpc,generation);
      for(const [id,checkpoint] of pending){
        // Ignore late refreshes after explicit resume or a newer handoff attempt.
        if(m.subscriptions.get(id)!==checkpoint||this.checking.has(id))continue;
        if(!loaded.has(id))this.save(id,'released');
      }
    })();
    this.refreshing=task;
    try{await task;}finally{if(this.refreshing===task)this.refreshing=null;}
  }
  start() {
    this.stop();
    if(this.manager.connection.state!=='connected'||!this.entries().some(v=>v.state!=='released'))return;
    this.timer=setTimeout(async()=>{try{await this.refresh();}catch{/* Keep unconfirmed intent; never claim success on a failed read. */}finally{this.start();}},5000);
    this.timer.unref?.();
  }
  stop() {clearTimeout(this.timer);this.timer=null;}
}
