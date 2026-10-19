import {messageInput} from './message-input.mjs';
import {asyncQuestions,replyText} from '../public/questions.js';
import {taskNotice} from '../public/connection-state.js';
import {summarizeTitle} from './thread-title.mjs';
import { EventEmitter } from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { RpcClient } from './rpc-client.mjs';
import {ThreadHandoffs} from './thread-handoff.mjs';
import {permissionParams,turnOptions} from './composer.mjs';
import {readLiveStatus} from './status-read.mjs';
import {ArchiveSync} from './archive-sync.mjs';
import {refreshDesktopDiscovery} from './desktop-discovery.mjs';
import {prepareThreadStart,routingTimeout} from './thread-start.mjs';

export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST', details) { super(message); Object.assign(this, {status, code, details}); }
}

export function validateSelection(models, model, effort) {
  if (!model && !effort) return {};
  const selected = models.find(item => item.model === model || item.id === model);
  if (!selected) throw new AppError('该模型不在远端返回的模型目录中。请刷新模型列表。');
  if (effort && !(selected.supportedReasoningEfforts || []).some(item => (typeof item === 'string' ? item : item.reasoningEffort) === effort)) {
    throw new AppError('所选模型不支持这个思考档位。');
  }
  return {model: selected.model || selected.id, ...(effort ? {effort} : {})};
}

export function classifyRequest(method) {
  if (method === 'item/tool/requestUserInput') return 'question';
  if (/commandExecution\/requestApproval|fileChange\/requestApproval/.test(method)) return 'approval';
  if (method === 'item/permissions/requestApproval') return 'permissions';
  if (method === 'mcpServer/elicitation/request') return 'elicitation';
  return 'unsupported';
}

export const requestKey = id => `${typeof id}:${String(id)}`;

export class Manager extends EventEmitter {
  questionSubmissions = new Map();
  constructor({titleStore=null, host, rpcFactory = () => new RpcClient(), remote, identity, tunnelFactory, fileReader, retryDelays=[3000,8000]} = {}) {
    super(); this.fileReader=fileReader; this.fileReads=0; this.expectedHost=host; this.rpcFactory = rpcFactory; this.remote = remote; this.identity = identity; this.tunnelFactory = tunnelFactory;
    this.titleStore=titleStore;this.autoTitles=new Map();this.titleJobs=new Map();this.createdSnapshots=new Map();this.pendingDiscovery=new Set();
    if(titleStore){try{this.autoTitles=new Map(JSON.parse(readFileSync(titleStore,'utf8')));}catch{}}
    this.subscriptionStore=titleStore?titleStore+'.subscriptions.json':null;
    this.subscriptions=new Map();this.recoveryFailures=new Map();
    if(this.subscriptionStore){try{this.subscriptions=new Map(JSON.parse(readFileSync(this.subscriptionStore,'utf8')));}catch{}}
    this.handoffStore=titleStore?titleStore+'.handoffs.json':null;
    if(this.handoffStore){try{for(const [id,handoff] of JSON.parse(readFileSync(this.handoffStore,'utf8')))this.subscriptions.set(id,{...this.subscriptions.get(id),handoff});}catch{}}
    this.noticeStore=titleStore?titleStore+'.notices.json':null;
    this.notices=new Map();
    if(this.noticeStore){try{this.notices=new Map(JSON.parse(readFileSync(this.noticeStore,'utf8')));}catch{}}
    this.connectionStore=titleStore?titleStore+'.connection.json':null;
    this.restoreOnStart=true;
    if(this.connectionStore){try{this.restoreOnStart=JSON.parse(readFileSync(this.connectionStore,'utf8')).enabled;}catch{}}
    this.instanceId=randomUUID();this.statusRevision=0;
    this.connection = {state: 'disconnected', stage: '尚未连接'};
    this.host = {...host, hostname: host.alias}; this.service = {running: false};
    this.models = []; this.modelReads = new WeakMap(); this.projects = []; this.controlled = new Map(); this.requests = new Map(); this.errors = [];
    this.activeTurns = new Map(); this.conflicts = new Set(); this.rpc = null; this.tunnel = null;
    this.startingTurns = new Set(); this.finishedTurns = new Map();
    this.threadMutations=new Map();this.handoffs=new ThreadHandoffs(this,AppError);
    this.retryDelays=retryDelays;this.retryResume=null;
    this.connecting = null; this.retry = null; this.manualDisconnect = false; this.serviceSession = null; this.generation = 0; this.releasing = false; this.mutations = 0; this.passiveMethods = new Set();
    this.archiveSync=new ArchiveSync(this,titleStore?titleStore+'.archive-sync.json':null);
  }
  status() {
    const live=this.connection.state==='connected'&&this.rpc?.connected;
    return {instanceId:this.instanceId,revision:this.statusRevision,host: this.host, connection: this.connection, service: {...this.service,releasing:this.releasing},
      controlledSessions:[...this.controlled].map(([id,info])=>({id,...info,status:live?info.status||{type:'unknown'}:{type:'unknown'},pendingRequests:[...this.requests.values()].filter(request=>request.threadId===id).length})),
      subscribedThreads:[...this.subscriptions].filter(([,v])=>!v.handoff).map(([id])=>id), handoffs:this.handoffs.entries(), controlledThreads: [...this.controlled.keys()], pendingRequests: [...this.requests.values()], recoveryFailures:[...this.recoveryFailures.values()], errors: this.errors};
  }
  publish(method, params) {
    if(method==='manager/status')params={...params,revision:++this.statusRevision};
    const threadId=params.threadId||params.thread?.id;
    const notice=taskNotice(method,params,{host:this.expectedHost.id || this.expectedHost.alias,known:this.subscriptions.has(threadId)});
    if(notice&&method!=='manager/request'&&!this.notices.has(notice.key)){
      this.notices.set(notice.key,{method,params});
      this.saveState(this.noticeStore,[...this.notices]);
    }
    this.emit('event', {method, params});
  }
  saveState(file,value) {
    if(!file)return;
    mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);
  }
  replayNotices() {
    return [...this.notices].map(([key,event])=>({method:'manager/taskNotice',params:{key,event}}));
  }
  acknowledgeNotice(key) {
    // Older pending records used the display alias; accept their canonical ID key too.
    let acknowledged=this.notices.delete(key);
    for(const [stored,event] of this.notices){
      if(taskNotice(event.method,event.params,{host:this.expectedHost.id || this.expectedHost.alias,known:true})?.key===key){
        this.notices.delete(stored);acknowledged=true;
      }
    }
    if(acknowledged)this.saveState(this.noticeStore,[...this.notices]);
    return {acknowledged};
  }
  restoreConnection() {
    if(this.restoreOnStart&&[...this.subscriptions.values()].some(v=>!v.handoff||v.handoff.state!=='released'))return this.connect();
  }
  update(patch) { this.connection = {...this.connection, ...patch}; this.publish('manager/status', this.status()); }
  record(error, stage = this.connection.stage, {diagnosticOnly=false} = {}) {
    const entry = {message: error.message || String(error), stage, time: new Date().toISOString(), ...(diagnosticOnly?{diagnosticOnly:true}:{})};
    this.errors = [...this.errors.slice(-29), entry]; this.publish('manager/error', entry); return entry;
  }
  clearDiagnosticHistory() {
    // Acknowledge past diagnostics only; keep subscriptions and live execution state.
    this.errors = [];
    this.recoveryFailures.clear();
    const status = this.status();
    this.publish('manager/status', status);
    return status;
  }
  requireConnected() {
    if (this.connection.state !== 'connected' || !this.rpc?.connected) throw new AppError('远端未连接。请先连接或等待重连。', 503, 'DISCONNECTED');
  }
  requireWritable() {
    this.requireConnected();
    if (this.releasing) throw new AppError('正在释放控制权。请等待检查结束。',409,'RELEASING');
  }
  requireCapability(feature) {
    const capability=this.service.protocolValidation?.features?.[feature];
    if(capability?.supported===false)throw new AppError('当前引擎不支持此操作：'+capability.reason,409,'FEATURE_UNAVAILABLE');
  }
  async withMutation(work,threadId=null) {
    this.requireWritable();if(threadId)this.handoffs.assertAvailable(threadId);this.mutations++;
    if(threadId)this.threadMutations.set(threadId,(this.threadMutations.get(threadId)||0)+1);
    try{return await work();}finally{this.mutations--;if(threadId){const count=this.threadMutations.get(threadId)-1;if(count)this.threadMutations.set(threadId,count);else this.threadMutations.delete(threadId);}}
  }
  async serviceAction(action) {
    const [validation,script,relay,reader] = await Promise.all(['protocol-check.py','remote-service.py','output-relay.py','passive-store.py'].map(name=>readFile(new URL('../scripts/'+name, import.meta.url), 'utf8')));
    const read=()=>this.remote(`ACTION=${JSON.stringify(action)}\nRELAY_SOURCE=${JSON.stringify(relay)}\nimport base64\nOUTPUT_READER_SOURCE=base64.b64decode(${JSON.stringify(Buffer.from(reader).toString('base64'))}).decode('utf-8')\n${validation}\n${script}`, {timeoutMs: 90000});
    return action==='projects'?this.readStateSnapshot(read):read();
  }
  async notifyDesktopArchive(threadId, archived) {
    const script=await readFile(new URL('../scripts/desktop-notify.py',import.meta.url),'utf8');
    const encoded=Buffer.from(JSON.stringify({threadId,archived})).toString('base64');
    return this.remote(`import base64,json\nPAYLOAD=json.loads(base64.b64decode('${encoded}'))\n${script}`,{timeoutMs:10000});
  }
  async passive(action, payload = {}) {
    const script=await readFile(new URL('../scripts/passive-store.py',import.meta.url),'utf8');
    const encoded=Buffer.from(JSON.stringify({action,...payload})).toString('base64');
    const read=()=>this.remote(`import base64,json\nPAYLOAD=json.loads(base64.b64decode('${encoded}'))\n${script}`,{timeoutMs:action==='image'?180000:45000});
    return ['sidebar','sidebarMetadata','threads'].includes(action)?this.readStateSnapshot(read):read();
  }
  async readStateSnapshot(read) {
    const rpc=this.rpc,generation=this.generation;
    try {return await read();}
    catch(error) {
      if(!/unable to open database file/i.test(error.message)||!rpc?.connected||this.rpc!==rpc||this.generation!==generation||
        !this.service.protocolValidation||this.service.protocolValidation.unsupportedMethods?.includes('thread/list'))throw error;
      // An idle native WAL store may have no sidecars. Let its owning engine
      // open it through a read-only RPC; never create or modify SQLite files here.
      this.stateStoreReads??=new WeakMap();
      let pending=this.stateStoreReads.get(rpc);
      if(!pending){
        pending=rpc.request('thread/list',{limit:1,sortKey:'updated_at',sortDirection:'desc',useStateDbOnly:true,sourceKinds:[]},{timeoutMs:10000});
        this.stateStoreReads.set(rpc,pending);
      }
      try {await pending;}finally{if(this.stateStoreReads.get(rpc)===pending)this.stateStoreReads.delete(rpc);}
      if(this.rpc!==rpc||this.generation!==generation||!rpc.connected)throw new AppError('连接已变化。请重新刷新列表。',409,'CONNECTION_CHANGED');
      return read();
    }
  }
  async readWithFallback(method, params, action, payload = {}) {
    if(payload.cursor?.startsWith('db:')||this.passiveMethods.has(method)||this.service.protocolValidation?.unsupportedMethods?.includes(method)){
      if(payload.cursor&&!payload.cursor.startsWith('db:'))throw new AppError('历史读取方式已变化。请刷新会话，再加载更早记录。',409,'HISTORY_CURSOR_CHANGED');
      return this.passive(action,payload);
    }
    try {return await this.rpc.request(method,params,{timeoutMs:3000});}
    catch(error) {
      if(!this.rpc?.connected)throw error;
      this.passiveMethods.add(method);
      this.publish('manager/notice',{message:`${method} 读取较慢，已改为只读历史快照。`,time:new Date().toISOString()});
      if(payload.cursor&&!payload.cursor.startsWith('db:'))throw new AppError('历史读取方式已变化。请刷新会话，再加载更早记录。',409,'HISTORY_CURSOR_CHANGED');
      return this.passive(action,payload);
    }
  }
  async connect() {
    if (this.connection.state === 'connected') return this.status();
    if (this.connecting) return this.connecting;
    this.restoreOnStart=true;this.saveState(this.connectionStore,{enabled:true});
    this.manualDisconnect = false; clearTimeout(this.retry);
    const generation = ++this.generation;
    const attempt=this.connectWithRetry(generation).finally(() => {if(this.connecting===attempt)this.connecting = null;});
    this.connecting=attempt;return attempt;
  }
  async connectWithRetry(generation) {
    for(let attempt=0;;attempt++){
      try{return await this.doConnect(generation);}
      catch(error){
        if(generation!==this.generation)throw error;
        const denied=/Permission denied|Host key|身份不符|协议不兼容/i.test(error.message);
        const transient=/SSH 操作超时|Operation timed out|Connection timed out|Connection refused|Connection reset|Connection closed|Broken pipe|Timeout, server|ECONN|WebSocket|SSH 隧道已退出|建立 SSH 隧道超时/i.test(error.message)||error.code==='RPC_TIMEOUT';
        if(denied||!transient||attempt>=this.retryDelays.length)throw error;
        const delay=this.retryDelays[attempt];
        this.update({state:'reconnecting',stage:`网络连接中断，${Math.ceil(delay/1000)} 秒后重试（${attempt+1}/${this.retryDelays.length}）`,error:null});
        let resume;
        await new Promise(resolve=>{resume=resolve;this.retryResume=resolve;this.retry=setTimeout(resolve,delay);});
        if(this.retryResume===resume)this.retryResume=null;
        if(generation!==this.generation)throw new Error('连接已取消。');
      }
    }
  }
  async doConnect(generation) {
    let tunnel, rpc;
    try {
      this.recoveryFailures.clear();
      this.update({state: 'connecting', stage: '核验目标机器', error: null});
      const identity = await this.identity();
      if (generation !== this.generation) throw new Error('连接已取消。');
      if (identity.user !== this.expectedHost.user || identity.home !== this.expectedHost.home) throw new Error('目标身份不符。已停止连接。');
      this.host = {...this.host, ...identity};
      this.update({stage: '检查专用 Codex 服务'});
      const service = await this.serviceAction('ensure');
      if (generation !== this.generation) throw new Error('连接已取消。');
      const session = `${service.pid}:${service.startedAt}:${service.version}`;
      const sameService = this.serviceSession === session;
      this.serviceSession = session; this.service = service; this.host.version = service.version;
      if (!sameService) { this.controlled.clear(); this.activeTurns.clear();this.passiveMethods.clear(); }
      this.update({stage: '建立 SSH 隧道'});
      tunnel = await this.tunnelFactory();
      if (generation !== this.generation) throw new Error('连接已取消。');
      this.tunnel = tunnel;
      rpc = this.rpcFactory(); this.rpc = rpc;
      rpc.on('error', error => {if(!this.stoppingService)this.record(error, '协议连接');});
      rpc.on('notification', event => {if(this.rpc===rpc)this.onNotification(event);});
      rpc.on('serverRequest', event => {if(this.rpc===rpc)this.onRequest(event);});
      rpc.on('close', () => { if (this.rpc === rpc) this.onDisconnect('Codex 连接已断开。'); });
      tunnel.child.on('exit', code => { if (this.tunnel === tunnel) this.onDisconnect(`SSH 隧道已退出（${code}）。`); });
      this.update({stage: '初始化 Codex 协议'});
      const initialized = await rpc.connect(tunnel.url);
      if (generation !== this.generation) throw new Error('连接已取消。');
      const engineVersion=initialized.userAgent?.match(/\/(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/)?.[1]||service.version;
      this.service = {...this.service, installedVersion:service.version,version:engineVersion,protocol: initialized};
      this.host.version=engineVersion;
      this.update({stage: '读取模型和项目'});
      this.models = await this.fetchAllModels();
      try {this.projects = (await this.serviceAction('projects')).data || [];} catch (error) {this.projects = [];this.record(error, '项目列表');}
      // Loaded-list is not a subscription registry. Idle threads can unload while offline.
      for (const [id, checkpoint] of [...this.subscriptions]) {
        if(checkpoint.handoff)continue;
        if(generation!==this.generation||this.rpc!==rpc)throw new Error('连接已取消。');
        const recoveredAt=Math.floor(Date.now()/1000);
        try {
          // Resume may discard a terminal goal from the loaded session. Snapshot it first.
          const priorGoal=await rpc.request('thread/goal/get',{threadId:id},{timeoutMs:5000}).then(r=>r.goal).catch(()=>null);
          const result=await rpc.request('thread/resume',{threadId:id,excludeTurns:true});
          if(generation!==this.generation||this.rpc!==rpc)throw new Error('连接已取消。');
          this.rememberControl(result);
          this.publish('manager/status',this.status());
          await this.recoverNotices(rpc,id,checkpoint.since,priorGoal);
          this.subscriptions.set(id,{since:recoveredAt});this.saveSubscriptions();
        } catch(error) {
          if(!rpc.connected||generation!==this.generation||this.rpc!==rpc)throw error;
          this.controlled.delete(id);
          this.recoveryFailures.set(id,{threadId:id,message:error.message||String(error)});
          this.record(error,'恢复会话订阅：'+id,{diagnosticOnly:true});
          // Keep the desired subscription and checkpoint for the next attempt.
        }
      }
      this.update({state: 'connected', stage: '已连接', connectedAt: new Date().toISOString(), error: null});
      this.handoffs.start();
      return this.status();
    } catch (error) {
      if (this.rpc === rpc) this.rpc = null;
      if (this.tunnel === tunnel) this.tunnel = null;
      rpc?.close(); tunnel?.child.kill();
      if (generation === this.generation) {this.record(error);this.update({state: 'error', error: error.message});}
      throw error;
    }
  }
  onDisconnect(message) {
    this.handoffs.stop();
    if(this.stoppingService)return;
    if(this.connecting&&this.connection.state!=='connected'){this.rpc?.close();return;}
    if (this.manualDisconnect || this.connection.state === 'disconnected' || this.connection.state === 'reconnecting') return;
    const rpc = this.rpc, tunnel = this.tunnel; this.rpc = null; this.tunnel = null; this.requests.clear();
    rpc?.close(); tunnel?.child.kill();
    this.record(new Error(message), '连接中断');
    this.update({state: 'reconnecting', stage: '连接中断，正在重连', error: message});
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect().catch(()=>{}), 3000);
  }
  disconnect({preserveIntent=false}={}) {
    this.handoffs.stop();
    if(!preserveIntent){this.restoreOnStart=false;this.saveState(this.connectionStore,{enabled:false});}
    this.manualDisconnect = true; this.generation++; this.connecting=null;clearTimeout(this.retry);
    this.retryResume?.();this.retryResume=null;
    const rpc = this.rpc, tunnel = this.tunnel; this.rpc=null; this.tunnel=null; this.requests.clear();
    rpc?.close();tunnel?.child.kill();
    this.update({state: 'disconnected', stage: '已断开。远端专用服务继续运行。'});
    return this.status();
  }
  async refreshCatalog(kind) {
    this.requireConnected();
    const rpc = this.rpc, generation = this.generation;
    const data = kind === 'models' ? await this.fetchAllModels(rpc) : (await this.serviceAction('projects')).data;
    this.requireConnected();
    if (this.rpc !== rpc || this.generation !== generation) throw new AppError('连接已变化。请重新刷新列表。', 409, 'CONNECTION_CHANGED');
    if (!Array.isArray(data)) throw new AppError('目标机器返回的列表格式无效。', 502, 'INVALID_CATALOG');
    this[kind] = data;
    return data;
  }
  async fetchAllModels(rpc = this.rpc) {
    if (this.modelReads.has(rpc)) return this.modelReads.get(rpc);
    // The engine may refresh its upstream catalog before replying. Allow the
    // normal RPC deadline and share reads across browser clients on this RPC.
    const read = (async () => {
      const models = []; let cursor;
      do {const page = await rpc.request('model/list', {limit:100, includeHidden:false, ...(cursor?{cursor}:{})},{timeoutMs:30000});models.push(...page.data);cursor=page.nextCursor;} while(cursor);
      return models;
    })();
    this.modelReads.set(rpc, read);
    try { return await read; }
    finally { if (this.modelReads.get(rpc) === read) this.modelReads.delete(rpc); }
  }
  onNotification({method, params}) {
    const id = params?.threadId || params?.thread?.id;
    if (method === 'mcpServer/startupStatus/updated' && params?.name === 'codex_apps' && params.status === 'failed') {
      const detail=typeof params.error==='string'?params.error:params.error?.message || (params.error?JSON.stringify(params.error):'未知原因');
      this.record(new Error(detail),'应用连接器后台初始化'+(id?' · '+id:''),{diagnosticOnly:true});
    }
    if (method === 'turn/started' && id) {
      this.activeTurns.set(id, params.turn.id);
      if(this.controlled.has(id))this.controlled.get(id).status={type:'active'};
    }
    if (method === 'turn/completed' && id) {
      this.activeTurns.delete(id);
      this.finishedTurns.set(id,params.turn.id);
      if(this.controlled.has(id))Object.assign(this.controlled.get(id),{status:{type:'idle'},lastTurnStatus:params.turn.status});
    }
    if (method === 'serverRequest/resolved') {this.requests.delete(requestKey(params.requestId));this.publish('manager/status',this.status());}
    if (method === 'thread/closed' && id) {this.controlled.delete(id);this.activeTurns.delete(id);this.handoffs.closed(id);}
    if(method==='thread/status/changed'&&this.controlled.has(id))this.controlled.get(id).status=params.status;
    if (['thread/name/updated','thread/status/changed','turn/started','turn/completed'].includes(method)) this.publish('manager/status', this.status());
    this.publish(method, params);
  }
  onRequest(event) {
    const entry = {...event, key:requestKey(event.id), threadId: event.params?.threadId, kind: classifyRequest(event.method)};
    this.requests.set(entry.key, entry); this.publish('manager/request', entry); this.publish('manager/status', this.status());
  }
  async threads({cursor, search, cwd, archived} = {}) {
    this.requireConnected();
    const result=await this.readWithFallback('thread/list', {limit: 50, sortKey:'updated_at', sortDirection:'desc', useStateDbOnly:true,sourceKinds:[],
      ...(cursor?{cursor}:{}), ...(search?{searchTerm:search}:{}), ...(cwd?{cwd}:{}), ...(archived?{archived:true}:{})},'threads',{cursor,search,cwd,archived});
    if(result.historySource!=='snapshot'){
      const metadata=await this.passive('sidebarMetadata',{threadIds:(result.data||[]).map(t=>t.id)});
      result.data=(result.data||[]).filter(t=>!t.ephemeral&&t.threadSource!=='ambient_suggestions').map(t=>({...t,...metadata.data[t.id]}));
    }
    if(result.historySource==='snapshot')for(const thread of result.data)thread.status=this.controlled.get(thread.id)?.status||{type:'unknown'};
    for(const thread of result.data||[]){const name=this.autoTitles.get(thread.id)?.lastTitle;if(name)thread.name=name;}
    return result;
  }
  async history(id, cursor, withOutputs=false, outputVersions={}, preview=false, outputEncoding=null) {
    this.requireConnected();
    const result=await this.passive('history',{threadId:id,cursor,withOutputs,outputVersions,preview,outputEncoding,allowMissingStore:this.createdSnapshots.has(id)&&this.controlled.has(id)});
    if(result.historySource==='snapshot'&&!this.controlled.has(id))for(const turn of result.data||[])if(turn.status==='inProgress'){turn.persistedStatus=turn.status;turn.status='unknown';}
    return result;
  }
  async openFile(id,itemId,payload,options) {
    this.requireConnected();
    if(this.fileReads>=4)throw new AppError('文件读取较多，请稍后重试。',429);
    this.fileReads++;
    let released=false;
    const release=()=>{if(!released){released=true;this.fileReads--;}};
    try {
      const transfer=await this.fileReader({...payload,threadId:id,itemId},options);
      transfer.body.once('close',release);transfer.body.once('end',release);
      if(transfer.body.destroyed)release();
      return transfer;
    } catch(error){release();throw error;}
  }
  async image(id,itemId,{preview=false,part=null,reference=null}={}) {
    this.requireConnected();
    return this.passive('image',{threadId:id,itemId,preview,part,reference});
  }
  async detail(id, outputVersions={}, preview=false, outputEncoding=null, fast=false) {
    this.requireConnected();
    const rpc=this.rpc,generation=this.generation;
    const queueCapability=this.service.protocolValidation?.features?.queue;
    const queueRead=(preview||fast)?Promise.resolve(null):queueCapability?.supported===false?Promise.resolve({data:[],error:queueCapability.reason}):this.controlled.has(id)?readLiveStatus(this,'thread/queue/list',{threadId:id,limit:50}).then(result=>{
      if(!Array.isArray(result.data))throw new Error('排队输入返回格式无效。');return result;
    }).catch(error=>({data:[],error:error.message})):Promise.resolve(null);
    const goalRead=!preview&&!fast&&this.controlled.has(id)?readLiveStatus(this,'thread/goal/get',{threadId:id}).catch(error=>({goal:null,error:/not found|not loaded|does not exist|ephemeral thread does not support goals/i.test(error.message)?null:error.message})):Promise.resolve({goal:null});
    const backgroundRead=!preview&&!fast&&this.controlled.has(id)?readLiveStatus(this,'thread/backgroundTerminals/list',{threadId:id,limit:100}).catch(error=>({data:[],error:error.message})):Promise.resolve(null);
    const [{thread},page,goalResult,queue,backgroundTerminals]=await Promise.all([
      // Browsing desktop-owned history must not refresh the engine's activity or subscription.
      this.readThreadMetadata(id,preview||fast||!this.controlled.has(id)||!!this.subscriptions.get(id)?.handoff),
      this.history(id,undefined,!!this.service.outputJournal,outputVersions,preview,outputEncoding),goalRead,queueRead,backgroundRead,
    ]);
    this.requireConnected();
    if(this.rpc!==rpc||this.generation!==generation)throw new AppError('连接已变化，请重新读取会话。',409,'CONNECTION_CHANGED');
    const known=this.controlled.get(id);
    if(known?.status?.type==='idle'&&!known.lastTurnStatus&&['completed','failed','interrupted'].includes(page.data?.[0]?.status))known.lastTurnStatus=page.data[0].status;
    return {thread:{...thread, ...(this.autoTitles.get(id)?.lastTitle?{name:this.autoTitles.get(id).lastTitle}:{}), ...(known ? {model:known.model, reasoningEffort:known.effort,status:known.status||thread.status}:page.historySource==='snapshot'?{status:{type:'unknown'}}:{})}, turns:[...(page.data||[])].reverse(), nextCursor:page.nextCursor,historySource:page.historySource||'protocol',
      outputPreview:preview, controlled:!!known, controlState:known?'controlled':this.conflicts.has(id)?'conflict':'viewing', handoff:this.handoffs.entries().find(v=>v.threadId===id)||null, goal:goalResult.goal,goalError:goalResult.error||null,queue,backgroundTerminals,
      pendingRequests:[...this.requests.values()].filter(r=>r.threadId===id)};
  }
  async readThreadMetadata(id,passive) {
    try {
      const result=await (passive?this.passive('detail',{threadId:id}):this.readWithFallback('thread/read',{threadId:id,includeTurns:false},'detail',{threadId:id}));
      if(passive)this.createdSnapshots.delete(id);return result;
    }catch(error){
      // A brand-new empty thread may not have a durable state row yet.
      // Only use metadata returned by our successful thread/start, never mask other failures.
      const created=this.createdSnapshots.get(id);
      if(created&&this.controlled.has(id)&&/未找到会话：|no rollout found for thread id/i.test(error.message))return {thread:created};
      throw error;
    }
  }
  saveSubscriptions() {
    if(!this.subscriptionStore)return;
    // Write handoff intent first; old releases must also see no auto-resume entry.
    this.saveState(this.handoffStore,[...this.subscriptions].filter(([,v])=>v.handoff).map(([id,v])=>[id,v.handoff]));
    this.saveState(this.subscriptionStore,[...this.subscriptions].filter(([,v])=>!v.handoff));
  }
  async recoverNotices(rpc,id,since,priorGoal=null) {
    const {goal:currentGoal}=await rpc.request('thread/goal/get',{threadId:id},{timeoutMs:5000}).catch(error=>{
      if(/ephemeral thread does not support goals|unknown method|method not found/i.test(error.message))return {goal:null};
      throw error;
    });
    if(this.rpc!==rpc)throw new Error('连接已变化。');
    const goal=currentGoal||priorGoal;
    if(goal&&goal.updatedAt>=since)this.publish('thread/goal/updated',{threadId:id,goal});
    if(this.service.outputJournal){
      const journal=await this.passive('notices',{threadId:id,since});
      if(this.rpc!==rpc)throw new Error('连接已变化。');
      for(const event of journal.data||[])this.publish(event.method,event.params);
    }
    let cursor;
    do {
      const page=await rpc.request('thread/turns/list',{threadId:id,limit:50,sortDirection:'desc',itemsView:'summary',...(cursor?{cursor}:{})},{timeoutMs:10000});
      if(this.rpc!==rpc)throw new Error('连接已变化。');
      for(const turn of page.data||[])if(['completed','failed','interrupted'].includes(turn.status)&&turn.completedAt>=since)this.publish('turn/completed',{threadId:id,turn});
      const old=(page.data||[]).some(turn=>turn.completedAt!=null&&turn.completedAt<since);
      cursor=old?null:page.nextCursor;
    }while(cursor);
  }
  rememberControl(result,{explicit=false}={}) {
    if(this.subscriptions.get(result.thread.id)?.handoff){
      if(!explicit)return false;
      this.subscriptions.set(result.thread.id,{since:Math.floor(Date.now()/1000)});this.saveSubscriptions();
    }
    if(!this.subscriptions.has(result.thread.id)){this.subscriptions.set(result.thread.id,{since:Math.floor(Date.now()/1000)});this.saveSubscriptions();}
    this.controlled.set(result.thread.id, {model:result.model, effort:result.reasoningEffort, cwd:result.cwd || result.thread.cwd,status:result.thread.status});
    this.conflicts.delete(result.thread.id);
    this.recoveryFailures.delete(result.thread.id);
    if(result.thread.status?.type==='idle')this.activeTurns.delete(result.thread.id);
    for (const turn of result.thread.turns || []) if (turn.status === 'inProgress') this.activeTurns.set(result.thread.id, turn.id);
    return true;
  }
  handoff(id) {return this.handoffs.end(id);}
  async takeover(id) {
    this.requireWritable();
    this.requireCapability('takeover');
    return this.withMutation(async()=>{
    try {
      const rpc=this.rpc,generation=this.generation;
      const result=await rpc.request('thread/resume', {threadId:id,excludeTurns:true}, {timeoutMs:60000});
      if(this.rpc!==rpc||this.generation!==generation)throw new AppError('连接已变化，请重连后核对会话状态。',409,'CONNECTION_CHANGED');
      this.rememberControl(result,{explicit:true});this.publish('manager/status',this.status());return this.detail(id);
    } catch(error) {
      if (/active writer/i.test(error.message)) {this.conflicts.add(id);throw new AppError('此会话仍在另一个入口中使用。请在原入口结束此会话的使用并等待释放，再重试。其他会话无需关闭。',409,'WRITER_CONFLICT');}
      throw error;
    }
    },id);
  }
  async newThread({cwd,name,model,effort,access}={}) {
    this.requireWritable();
    this.requireCapability('create');
    if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) throw new AppError('请提供远端项目的绝对路径。');
    const selection=validateSelection(this.models,model,effort);
    const permissions=permissionParams(access,true);
    const project=this.projects.find(project=>project.roots?.includes(cwd));
    return this.withMutation(async()=>{
    await prepareThreadStart(this);
    let result;
    try {result=await this.rpc.request('thread/start',{cwd,model:selection.model,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write',...permissions,serviceName:'remote_codex_manager',...(project?{projectId:project.id}:{}),
      ...(selection.effort?{config:{model_reasoning_effort:selection.effort}}:{})},{timeoutMs:60000});}
    catch(error){if(routingTimeout(error))throw new AppError('Codex 工作区路由发现超时。请检查目标机器的登录和网络，并刷新会话列表核对创建结果后再操作。草稿已保留。',503,'OUTCOME_UNKNOWN');if(error.code==='RPC_TIMEOUT'||!this.rpc?.connected)throw new AppError('创建结果尚未确认，目标机器可能已经创建。请刷新会话列表核对后再操作，不要重复创建。',502,'OUTCOME_UNKNOWN');throw error;}
    this.createdSnapshots.set(result.thread.id,result.thread);
    this.pendingDiscovery.add(result.thread.id);
    this.rememberControl(result);
    if(!name?.trim()){this.autoTitles.set(result.thread.id,{pendingFirstMessage:true});this.saveTitles();}
    if(name?.trim()) await this.rpc.request('thread/name/set',{threadId:result.thread.id,name:name.trim().slice(0,200)});
    this.publish('manager/status',this.status());return {thread:{...result.thread,projectId:project?.id??null},controlled:true};
    });
  }
  assertControl(id) {
    this.requireWritable();
    this.handoffs.assertAvailable(id);
    if (!this.controlled.has(id)) throw new AppError('当前为查看模式。请先点击“接管会话”。',409,'NOT_CONTROLLED');
  }
  async message(id,{text='',images=[],model,effort,access,mode,skills,plugins}={}) {
    this.assertControl(id);
    this.requireCapability('message');
    if(this.startingTurns.has(id))throw new AppError('上一条消息仍在确认中。请等待结果后再发送。',409,'SEND_PENDING');
    if(this.activeTurns.has(id)||this.controlled.get(id)?.status?.type==='active') throw new AppError('当前轮次仍在运行。请使用“引导当前任务”，或等待完成。',409,'TURN_ACTIVE');
    const input=messageInput(text,images);
    const selection=validateSelection(this.models,model,effort);
    this.startingTurns.add(id);
    try {
    return await this.withMutation(async()=>{
    let result;
    if(this.controlled.get(id)?.status?.type==='notLoaded') {
      const resumed=await this.rpc.request('thread/resume',{threadId:id,excludeTurns:true},{timeoutMs:60000});
      this.rememberControl(resumed);
      if(this.activeTurns.has(id)||resumed.thread.status?.type==='active')throw new AppError('原会话仍在运行，请等待完成或引导当前任务。',409,'TURN_ACTIVE');
    }
    try {
      const options=await turnOptions(this,id,{access,mode,skills,plugins},selection);
      result=await this.rpc.request('turn/start',{threadId:id,input:[...input,...options.input],...selection,...options.params},{timeoutMs:60000});
    } catch(error) {
      if(error.code==='RPC_TIMEOUT'||!this.rpc?.connected)throw new AppError('发送结果未确认。远端可能已经执行。请恢复连接并刷新会话，核对记录后再发送。',502,'OUTCOME_UNKNOWN');
      throw error;
    }
    if(result.turn.status==='inProgress'&&this.finishedTurns.get(id)!==result.turn.id)this.activeTurns.set(id,result.turn.id);
    Object.assign(this.controlled.get(id),selection);
    const naming=this.autoTitles.get(id);
    if(naming?.pendingFirstMessage&&!naming.manual){
      // Consume the first accepted message once, including across restarts. A
      // failed title write must never make a successfully sent message fail.
      naming.pendingFirstMessage=false;this.saveTitles();
      this.updateTitle(id,summarizeTitle(text,{hasImages:images.length>0}));
    }
    if(this.pendingDiscovery.delete(id))void refreshDesktopDiscovery(this,id);
    return result;
    },id);
    } finally {this.startingTurns.delete(id);}
  }
  saveTitles() {
    if(!this.titleStore)return;
    try{mkdirSync(path.dirname(this.titleStore),{recursive:true,mode:0o700});writeFileSync(this.titleStore+'.tmp',JSON.stringify([...this.autoTitles]),{mode:0o600});renameSync(this.titleStore+'.tmp',this.titleStore);}catch(error){this.record(error,'保存自动标题状态');}
  }
  updateTitle(id,name) {
    const info=this.autoTitles.get(id),rpc=this.rpc,generation=this.generation;
    if(!info||!name||info.manual||info.lastTitle||!rpc?.connected||this.titleJobs.has(id))return;
    const current=()=>this.rpc===rpc&&this.generation===generation&&rpc.connected&&!info.manual&&this.autoTitles.get(id)===info&&!this.subscriptions.get(id)?.handoff;
    const task=Promise.resolve().then(async()=>{
      if(!current())return;
      // Preserve an explicit title assigned from another entrance before this write.
      // turn/start can return before the new rollout's metadata has been flushed.
      // Retry only this read; never repeat the accepted message or name write.
      let thread;
      for(let attempt=0;;attempt++){
        if(!current())return;
        try{({thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false}));break;}
        catch(error){
          if(attempt>=4||!/no rollout found for thread id|rollout at [^\n]+ is empty$/i.test(error.message))throw error;
          await new Promise(resolve=>setTimeout(resolve,100*2**attempt));
        }
      }
      if(!current()||thread.name?.trim())return;
      await rpc.request('thread/name/set',{threadId:id,name});
      if(!current())return;
      info.lastTitle=name;this.saveTitles();
      this.publish('thread/name/updated',{threadId:id,threadName:name});
    }).catch(error=>this.record(error,'自动命名'))
      .finally(()=>{if(this.titleJobs.get(id)===task)this.titleJobs.delete(id);});
    this.titleJobs.set(id,task);
    return task;
  }
  async activeTurn(id) {
    if(this.activeTurns.has(id)) return this.activeTurns.get(id);
    const page=await this.history(id);
    const turn=(page.data||[]).find(t=>t.status==='inProgress');
    if(!turn)throw new AppError('该会话没有正在运行的轮次。',409,'NO_ACTIVE_TURN');
    this.activeTurns.set(id,turn.id);return turn.id;
  }
  async steer(id,{text='',images=[]}={}) {
    this.assertControl(id);
    this.requireCapability('steer');
    const input=messageInput(text,images);
    return this.withMutation(async()=>this.rpc.request('turn/steer',{threadId:id,expectedTurnId:await this.activeTurn(id),input}),id);
  }
  async answerQuestions(id,{turnId,itemId,answers}={}) {
    this.assertControl(id);this.requireCapability('steer');
    if(typeof turnId!=='string'||typeof itemId!=='string'||!answers||typeof answers!=='object')throw new AppError('问题回答格式无效。');
    const key=JSON.stringify([id,turnId,itemId]);
    const prior=this.questionSubmissions.get(key);
    if(prior==='sent')return {resolved:true};
    if(prior)throw new AppError(prior==='unknown'?'回答结果尚未确认，请先核对会话记录，避免重复发送。':'正在提交此问题，请等待结果。',409,prior==='unknown'?'OUTCOME_UNKNOWN':'SEND_PENDING');
    this.questionSubmissions.set(key,'pending');
    const rpc=this.rpc,generation=this.generation;
    try{return await this.withMutation(async()=>{
      const page=await this.history(id);
      this.assertControl(id);
      if(rpc!==this.rpc||generation!==this.generation)throw new AppError('连接已变化，请刷新后重试。',409,'CONNECTION_CHANGED');
      const request=asyncQuestions(page.data,id).find(r=>r.params.turnId===turnId&&r.params.itemId===itemId);
      if(!request)throw new AppError('问题已回答或原轮次已结束，请刷新会话。',409,'STALE_REQUEST');
      const questions=request.params.questions;
      if(Object.keys(answers).length!==questions.length||questions.some(q=>!Array.isArray(answers[q.id]?.answers)||answers[q.id].answers.length!==1||typeof answers[q.id].answers[0]!=='string'||!answers[q.id].answers[0].trim()||answers[q.id].answers[0].length>100000))throw new AppError('请回答所有问题。');
      await rpc.request('turn/steer',{threadId:id,expectedTurnId:turnId,input:[{type:'text',text:replyText(questions,answers)}]});
      this.questionSubmissions.set(key,'sent');return {resolved:true};
    },id);}catch(error){
      if(error.code==='RPC_TIMEOUT'||!rpc?.connected){this.questionSubmissions.set(key,'unknown');throw new AppError('回答结果尚未确认，草稿已保留。请先核对会话记录，避免重复发送。',502,'OUTCOME_UNKNOWN');}
      this.questionSubmissions.delete(key);throw error;
    }
  }
  async interrupt(id) {
    this.assertControl(id);this.requireCapability('stop');
    return this.withMutation(async()=>{
      let turnId;
      try{turnId=await this.activeTurn(id);}catch(error){if(error.code!=='NO_ACTIVE_TURN')throw error;}
      if(turnId)await this.rpc.request('turn/interrupt',{threadId:id,turnId});
      const terminals=await this.rpc.request('thread/backgroundTerminals/list',{threadId:id,limit:100});
      if(!Array.isArray(terminals.data))throw new AppError('无法核对后台命令，请刷新后重试。',502);
      for(const terminal of terminals.data)await this.rpc.request('thread/backgroundTerminals/terminate',{threadId:id,processId:terminal.processId});
      return {interrupted:!!turnId,terminated:terminals.data.map(t=>t.processId)};
    },id);
  }

  respond(key,body) {
    this.requireWritable();
    const entry=this.requests.get(String(key));
    if(!entry)throw new AppError('请求已结束或连接已变化。请刷新会话。',409,'STALE_REQUEST');
    if(entry.threadId)this.handoffs.assertAvailable(entry.threadId);
    const decision=body.decision;
    if(entry.kind==='question') {
      if(!body.answers || typeof body.answers!=='object')throw new AppError('请填写问题的回答。');
      const answers={};
      for(const q of entry.params.questions||[]) {
        const values=body.answers[q.id]?.answers;
        if(!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'||!v.trim()||v.length>100000))throw new AppError('请回答所有问题。');
        answers[q.id]={answers:values.map(v=>v.trim())};
      }
      this.rpc.respond(entry.id,{answers});
    } else if(entry.kind==='approval') {
      if(decision==='acceptForSession'&&!entry.params.availableDecisions?.includes(decision))throw new AppError('该请求未提供会话级授权。');
      if(!['accept','acceptForSession','decline','cancel'].includes(decision))throw new AppError('无效的审批选项。');
      const available=entry.params.availableDecisions;
      if(available?.length && !available.some(d=>d===decision))throw new AppError('该请求不支持此审批选项。');
      this.rpc.respond(entry.id,{decision});
    } else if(entry.kind==='permissions') {
      if(!['accept','decline','cancel'].includes(decision))throw new AppError('无效的审批选项。');
      this.rpc.respond(entry.id,{permissions:decision==='accept'?entry.params.permissions:{},scope:'turn'});
    } else if(entry.kind==='elicitation') {
      if(!['decline','cancel'].includes(decision))throw new AppError('首版不支持此连接器授权表单。请取消后在原客户端处理。');
      this.rpc.respond(entry.id,{action:decision,content:null});
    } else {
      if(decision!=='cancel'&&decision!=='decline')throw new AppError('此桌面工具尚未接入。请取消请求。');
      this.rpc.respondError(entry.id,{code:-32601,message:'远程管理器暂不支持此客户端工具。'});
    }
    this.requests.delete(String(key));this.publish('manager/status',this.status());return {resolved:true};
  }
  async release({allEntrancesDisconnected=false}={}) {
    if(!allEntrancesDisconnected)throw new AppError('停止目标服务影响所有入口。请先结束任务并断开其他入口，再明确确认。',409,'MAINTENANCE_CONFIRMATION_REQUIRED');
    this.requireWritable();
    this.requireCapability('release');
    if(this.mutations)throw new AppError('会话操作尚未返回结果。请等待操作结束，再释放控制权。',409,'SERVICE_BUSY');
    this.releasing=true;this.publish('manager/status',this.status());
    try {
    const blockers=[];
    for(const entry of this.requests.values())blockers.push({threadId:entry.threadId,reason:'存在待处理请求'});
    const loaded=await this.rpc.request('thread/loaded/list');
    for(const id of loaded.data||[]) {
      const {thread}=await this.rpc.request('thread/read',{threadId:id,includeTurns:false});
      if(thread.status?.type==='active'||this.activeTurns.has(id))blockers.push({threadId:id,reason:'会话仍在运行或等待输入'});
      const {goal}=await this.rpc.request('thread/goal/get',{threadId:id}).catch(error=>{
        if(/^ephemeral thread does not support goals(?::|$)/i.test(error.message))return {goal:null};
        throw new AppError('无法确认会话目标状态。请重试；若仍失败，请查看连接诊断。',502,'GOAL_CHECK_FAILED',{threadId:id,cause:error.message});
      });
      if(goal?.status==='active')blockers.push({threadId:id,reason:'目标模式仍在运行'});
      const terminals=await this.rpc.request('thread/backgroundTerminals/list',{threadId:id,limit:100});
      if(terminals.data?.length)blockers.push({threadId:id,reason:'后台命令仍在运行'});
      const queued=await this.rpc.request('thread/queue/list',{threadId:id,limit:1});
      if(!Array.isArray(queued.data))throw new AppError('无法确认排队输入。请刷新会话后再释放控制权。',502,'QUEUE_UNKNOWN');
      if(queued.data.length||queued.nextCursor)blockers.push({threadId:id,reason:'存在排队输入'});
    }
    if(blockers.length)throw new AppError('专用服务仍有任务。请先结束这些任务，再切回桌面。',409,'SERVICE_BUSY',blockers);
    this.stoppingService=true;
    try {await this.serviceAction('release');}
    catch(error) {this.stoppingService=false;if(!this.rpc?.connected)this.onDisconnect('专用服务已断开。请核对释放结果。');throw error;}
    this.disconnect();this.controlled.clear();this.activeTurns.clear();this.service={running:false};this.serviceSession=null;
    this.update({state:'disconnected',stage:'控制权已释放。现在可以打开远端桌面应用。',error:null});return this.status();
    } finally {this.stoppingService=false;this.releasing=false;this.publish('manager/status',this.status());}
  }
}
