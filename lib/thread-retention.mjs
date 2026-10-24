// Desktop 0.163 policy: retain at most 10 inactive owned threads for 3 hours.
// This manages subscriptions only; the native engine owns unloading and tasks.
export class ThreadRetention {
  constructor(manager,{now=Date.now,ttl=10800000,limit=10,retry=15000}={}) {
    Object.assign(this,{manager,now,ttl,limit,retry});
    this.views=new Map();this.inactive=new Map();this.retries=new Map();this.releasing=new Map();this.waking=new Map();
    this.timer=null;this.running=false;
  }
  attach(key) {const view={threadId:undefined,revision:-1};this.views.set(key,view);this.changed();return ()=>{if(this.views.get(key)===view){this.views.delete(key);this.changed();}};}
  viewed(id) {return [...this.views.values()].some(v=>v.threadId===undefined||v.threadId===id);}
  async view(key,id,revision) {
    const view=this.views.get(key);if(!view)return false;
    if(revision<=view.revision)return true;
    Object.assign(view,{threadId:id,revision});this.changed();
    if(id){
      await this.releasing.get(id)?.catch(()=>{});
      if(this.views.get(key)===view&&view.threadId===id&&view.revision===revision)await this.wake(id);
    }
    return true;
  }
  async wake(id) {
    const m=this.manager;
    if(!m.subscriptions.get(id)?.handoff?.automatic)return;
    if(this.waking.has(id))return this.waking.get(id);
    const pending=m.takeover(id);this.waking.set(id,pending);
    try{await pending;}finally{if(this.waking.get(id)===pending)this.waking.delete(id);this.changed();}
  }
  eligible(id,info) {
    const m=this.manager;
    // Web side chats cannot be resumed after native unload. Keep their runtime.
    return !info.ephemeral&&!this.viewed(id)&&info.status?.type==='idle'&&!m.subscriptions.get(id)?.handoff&&
      !m.references.preparing.has(id)&&!m.handoffs.checking.has(id)&&!m.handoffs.localBlockers(id).length&&
      (!m.createdSnapshots.has(id)||info.lastTurnStatus);
  }
  changed() {
    const m=this.manager,now=this.now();
    for(const [id,info] of m.controlled){
      if(this.eligible(id,info)){if(!this.inactive.has(id))this.inactive.set(id,now);}
      else {this.inactive.delete(id);this.retries.delete(id);}
    }
    for(const id of this.inactive.keys())if(!m.controlled.has(id)){this.inactive.delete(id);this.retries.delete(id);}
    this.schedule();
  }
  deadlines() {
    const m=this.manager,now=this.now();
    const entries=[...this.inactive].filter(([id])=>m.controlled.has(id)&&this.eligible(id,m.controlled.get(id))).sort((a,b)=>a[1]-b[1]);
    const ordinary=entries.filter(([id])=>!m.controlled.get(id).ephemeral);
    const over=new Set(ordinary.slice(0,Math.max(0,ordinary.length-this.limit)).map(([id])=>id));
    return entries.map(([id,since])=>[id,since,Math.max(over.has(id)?now:since+this.ttl,this.retries.get(id)||0)]);
  }
  candidates() {
    return this.deadlines().filter(([, ,due])=>due<=this.now());
  }
  schedule() {
    clearTimeout(this.timer);this.timer=null;
    const m=this.manager;
    if(this.running||m.connection.state!=='connected'||!m.rpc?.connected||m.service.protocolValidation?.features?.handoff?.supported!==true||!this.inactive.size)return;
    const now=this.now(),deadlines=this.deadlines();if(!deadlines.length)return;
    const due=Math.min(...deadlines.map(([, ,due])=>due));
    this.timer=setTimeout(()=>void this.sweep(),Math.max(0,due-now));this.timer.unref?.();
  }
  async sweep() {
    if(this.running)return;
    this.running=true;
    try {
      for(const [id,since] of this.candidates()){
        const m=this.manager,rpc=m.rpc,generation=m.generation;
        if(m.connection.state!=='connected'||!rpc?.connected)break;
        const canRelease=()=>m.rpc===rpc&&m.generation===generation&&!this.viewed(id)&&this.inactive.get(id)===since&&!m.references.preparing.has(id);
        const pending=m.handoffs.end(id,{automatic:true,canRelease});this.releasing.set(id,pending);
        try{await pending;this.inactive.delete(id);this.retries.delete(id);}
        catch{this.retries.set(id,this.now()+this.retry);}
        finally{this.releasing.delete(id);}
      }
    }finally{this.running=false;this.schedule();}
  }
  stop() {clearTimeout(this.timer);this.timer=null;this.inactive.clear();this.retries.clear();}
}
