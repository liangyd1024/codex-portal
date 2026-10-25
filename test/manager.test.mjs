import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Manager, AppError, validateSelection } from '../lib/manager.mjs';

const models = [
  { id: 'catalog-a', model: 'model-a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
  { id: 'model-b', supportedReasoningEfforts: ['medium'] },
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeRPC extends EventEmitter {
  connected = true;
  calls = [];
  responses = [];
  handlers = {};

  async connect(url) { this.connected = true; this.url = url; return { codexHome: '/Users/example/.codex', userAgent: 'codex/fake' }; }
  async request(method, params = {}, options = {}) {
    this.calls.push({ method, params: structuredClone(params), options: structuredClone(options) });
    if (this.handlers[method]) return this.handlers[method](params, options);
    if (method === 'account/read') return {account:{type:'chatgpt'}};
    if (method === 'model/list') return { data: models, nextCursor: null };
    if (method === 'thread/loaded/list') return { data: [] };
    if (method === 'thread/read') return { thread: { id: params.threadId, cwd: '/Users/example/project', status: { type: 'idle' } } };
    if (method === 'thread/turns/list') return { data: [], nextCursor: null };
    if (method === 'thread/goal/get') return { goal: null };
    if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null };
    if (method === 'thread/queue/list') return { data: [], nextCursor: null };
    if (method === 'thread/resume') return { thread: { id: params.threadId, turns: [], cwd: '/Users/example/project' }, model: 'model-a', reasoningEffort: 'high' };
    if (method === 'turn/start') return { turn: { id: 'turn-1', status: 'inProgress' } };
    if (method === 'thread/list') return { data: [], nextCursor: null };
    return {};
  }
  respond(id, result) { this.responses.push({ id, result }); }
  respondError(id, error) { this.responses.push({ id, error }); }
  close() { if (this.connected) { this.connected = false; this.emit('close', { code: 1000, reason: 'fake' }); } }
}

function fixture(t, handlers = {}) {
  const rpc = new FakeRPC();
  Object.assign(rpc.handlers, handlers);
  const serviceCalls = [];
  const manager = new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},
    remote: async () => assert.fail('Tests must never invoke a remote command.'),
    identity: async () => ({ user: 'example', home: '/Users/example', hostname: 'fake-host' }),
    tunnelFactory: async () => ({ url: 'ws://fake', child: Object.assign(new EventEmitter(), { kill() {} }) }),
    rpcFactory: () => rpc,
  });
  manager.serviceAction = async (action) => {
    serviceCalls.push(action);
    if (action === 'projects') return { data: [] };
    return { running: action !== 'release', pid: 123, version: '0.162.fake', startedAt: 'fixed-start' };
  };
  manager.passive = async(action, payload)=>{
    if(action==='detail')return await rpc.request('thread/read',{threadId:payload.threadId});
    assert.equal(action,'history');
    return {...await rpc.request('thread/turns/list',{threadId:payload.threadId,cursor:payload.cursor}),historySource:'snapshot'};
  };
  manager.rpc = rpc;
  manager.connection = { state: 'connected', stage: 'fake' };
  manager.models = structuredClone(models);
  t.after(() => { clearTimeout(manager.retry); manager.disconnect(); });
  return { manager, rpc, serviceCalls };
}

function approval(id, threadId = 'original') {
  return { id, method: 'item/commandExecution/requestApproval', params: { threadId, availableDecisions: ['accept', 'decline', 'cancel'] } };
}

const approvalKey = (id) => `${typeof id}:${String(id)}`;

test('model and effort selection uses the remote catalog and rejects unsupported choices', () => {
  assert.deepEqual(validateSelection(models), {});
  assert.deepEqual(validateSelection(models, 'catalog-a', 'high'), { model: 'model-a', effort: 'high' });
  assert.deepEqual(validateSelection(models, 'model-b', 'medium'), { model: 'model-b', effort: 'medium' });
  assert.throws(() => validateSelection(models, 'unlisted', 'high'), AppError);
  assert.throws(() => validateSelection(models, 'model-a', 'medium'), AppError);
  assert.throws(() => validateSelection(models, undefined, 'high'), AppError);
});

test('viewing a thread reads paginated history without resuming or controlling it', async (t) => {
  const { manager, rpc } = fixture(t, {
    'thread/turns/list': async () => ({ data: [{ id: 'newer' }, { id: 'older' }], nextCursor: 'older-page' }),
  });
  const detail = await manager.detail('original');
  assert.equal(detail.controlled, false);
  assert.equal(detail.controlState, 'viewing');
  assert.deepEqual(detail.turns.map((turn) => turn.id), ['older', 'newer']);
  assert.equal(detail.nextCursor, 'older-page');
  assert.deepEqual(rpc.calls.map((call) => call.method), ['thread/read', 'thread/turns/list']);
  assert.equal(manager.controlled.size, 0);
});

test('session overview reports lifecycle and pending requests, but marks disconnected state unknown',async(t)=>{
  const {manager}=fixture(t);await manager.takeover('original');
  manager.onNotification({method:'turn/started',params:{threadId:'original',turn:{id:'live'}}});
  manager.onRequest(approval('wait'));
  let session=manager.status().controlledSessions[0];
  assert.equal(session.status.type,'active');assert.equal(session.pendingRequests,1);
  manager.onNotification({method:'turn/completed',params:{threadId:'original',turn:{id:'live',status:'failed'}}});
  session=manager.status().controlledSessions[0];assert.equal(session.status.type,'idle');assert.equal(session.lastTurnStatus,'failed');
  manager.disconnect();assert.equal(manager.status().controlledSessions[0].status.type,'unknown');
});

test('message, steer, and interrupt cannot mutate a thread before takeover', async (t) => {
  const { manager, rpc } = fixture(t);
  for (const action of [() => manager.message('original', { text: 'hello' }), () => manager.steer('original', { text: 'hello' }), () => manager.interrupt('original')]) {
    await assert.rejects(action(), (error) => error.code === 'NOT_CONTROLLED' && error.status === 409);
  }
  assert.deepEqual(rpc.calls, []);
});

test('active writer conflict keeps the original id and never creates or forks a replacement', async (t) => {
  const { manager, rpc } = fixture(t, {
    'thread/resume': async () => { throw new Error('thread original already has an active writer'); },
  });
  await assert.rejects(manager.takeover('original'), (error) => error.code === 'WRITER_CONFLICT' && error.status === 409);
  assert.deepEqual(rpc.calls.map(({ method, params }) => ({ method, params })), [
    { method: 'thread/resume', params: { threadId: 'original', excludeTurns: true } },
  ]);
  assert.equal(manager.controlled.has('original'), false);
  assert.equal((await manager.detail('original')).controlState, 'conflict');
});

test('successful takeover preserves thread id and selected catalog values reach the new turn', async (t) => {
  const { manager, rpc } = fixture(t);
  assert.equal((await manager.takeover('original')).controlled, true);
  await manager.message('original', { text: '  继续检查  ', model: 'catalog-a', effort: 'high' });
  assert.deepEqual(rpc.calls.find((call) => call.method === 'turn/start').params, {
    threadId: 'original', input: [{ type: 'text', text: '继续检查' }], model: 'model-a', effort: 'high',
  });
  await assert.rejects(manager.message('original', { text: 'duplicate' }), (error) => error.code === 'TURN_ACTIVE');
  assert.equal(rpc.calls.filter((call) => call.method === 'turn/start').length, 1);
});

test('a timed-out send reports an unknown outcome and never replays the prompt', async (t) => {
  const { manager, rpc } = fixture(t, {'turn/start':async()=>{throw Object.assign(new Error('timeout'),{code:'RPC_TIMEOUT'});}});
  await manager.takeover('original');
  await assert.rejects(manager.message('original',{text:'hello',model:'model-a',effort:'low'}),error=>error.code==='OUTCOME_UNKNOWN'&&/可能已经执行/.test(error.message));
  assert.equal(rpc.calls.filter(call=>call.method==='turn/start').length,1);
});

test('two simultaneous sends cannot start duplicate turns', async(t)=>{
  const start=deferred();
  const {manager,rpc}=fixture(t,{'turn/start':()=>start.promise});
  await manager.takeover('original');
  const first=manager.message('original',{text:'first'});
  await assert.rejects(manager.message('original',{text:'second'}),error=>error.code==='SEND_PENDING');
  start.resolve({turn:{id:'one',status:'inProgress'}});await first;
  assert.equal(rpc.calls.filter(call=>call.method==='turn/start').length,1);
});

test('a completion event before a start reply does not leave a finished turn running', async(t)=>{
  const {manager,rpc}=fixture(t);
  await manager.takeover('original');
  rpc.handlers['turn/start']=async()=>{
    manager.onNotification({method:'turn/completed',params:{threadId:'original',turn:{id:'fast',status:'completed'}}});
    return {turn:{id:'fast',status:'inProgress'}};
  };
  await manager.message('original',{text:'fast'});
  assert.equal(manager.activeTurns.has('original'),false);
  await manager.message('original',{text:'next'});
  assert.equal(rpc.calls.filter(call=>call.method==='turn/start').length,2);
});

test('approval response retains the original id and rejects resolved or disconnected requests', async (t) => {
  const { manager, rpc } = fixture(t);
  for (const id of [7, 'approval-seven']) {
    manager.onRequest(approval(id));
    const key = approvalKey(id);
    manager.respond(key, { decision: 'accept' });
    assert.deepEqual(rpc.responses.at(-1), { id, result: { decision: 'accept' } });
    assert.throws(() => manager.respond(key, { decision: 'accept' }), (error) => error.code === 'STALE_REQUEST');
  }
  manager.onRequest(approval('expired'));
  manager.onNotification({ method: 'serverRequest/resolved', params: { requestId: 'expired', threadId: 'original' } });
  assert.throws(() => manager.respond(approvalKey('expired'), { decision: 'accept' }), (error) => error.code === 'STALE_REQUEST');
  manager.onRequest(approval('old-connection'));
  manager.onDisconnect('fake transport loss');
  clearTimeout(manager.retry);
  assert.equal(manager.requests.size, 0);
  assert.throws(() => manager.respond(approvalKey('old-connection'), { decision: 'accept' }), (error) => error.code === 'DISCONNECTED');
});

test('numeric and string approval ids with the same text do not overwrite each other', (t) => {
  const { manager } = fixture(t);
  manager.onRequest(approval(7));
  manager.onRequest(approval('7'));
  const pending = manager.status().pendingRequests;
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map((entry) => entry.id), [7, '7']);
  assert.deepEqual(pending.map((entry) => entry.key), ['number:7', 'string:7']);
  manager.respond('number:7', { decision: 'decline' });
  manager.respond('string:7', { decision: 'accept' });
});

test('reconnect restores subscriptions on the same service without replaying user mutations', async (t) => {
  const { manager, rpc } = fixture(t);
  manager.connection.state = 'disconnected';
  await manager.connect();
  await manager.takeover('original');
  await manager.message('original', { text: 'once', model: 'model-a', effort: 'high' });
  manager.onRequest(approval('old-approval'));
  manager.onDisconnect('fake loss');
  clearTimeout(manager.retry);
  const nextRPC = new FakeRPC();
  nextRPC.handlers['thread/loaded/list'] = async () => ({ data: ['original'] });
  manager.rpcFactory = () => nextRPC;
  await manager.connect();
  assert.equal(manager.connection.state, 'connected');
  assert.equal(manager.requests.size, 0);
  assert.equal(manager.controlled.has('original'), true);
  assert.equal(rpc.calls.filter((call) => call.method === 'turn/start').length, 1);
  assert.equal(nextRPC.calls.filter((call) => call.method === 'thread/resume').length, 1);
  assert.equal(nextRPC.calls.some((call) => ['turn/start', 'turn/steer', 'turn/interrupt'].includes(call.method)), false);
  assert.deepEqual(nextRPC.responses, []);
});

test('cancelled connection cannot overwrite a newer connection attempt',async(t)=>{
  const {manager}=fixture(t);manager.disconnect();const firstIdentity=deferred(),nextIdentity=deferred();let calls=0;
  manager.identity=()=>++calls===1?firstIdentity.promise:nextIdentity.promise;
  const first=manager.connect();const cancelled=assert.rejects(first,/连接已取消/);
  manager.disconnect();const second=manager.connect();
  firstIdentity.resolve({user:'example',home:'/Users/example'});await cancelled;
  assert.ok(manager.connecting);assert.equal(manager.connection.state,'connecting');
  nextIdentity.resolve({user:'example',home:'/Users/example'});await second;
  assert.equal(manager.connection.state,'connected');assert.equal(manager.connection.error,null);
});

test('transient connection failures retry a bounded number of times without replaying messages',async(t)=>{
  const {manager,rpc}=fixture(t);manager.disconnect();manager.retryDelays=[1,1];let attempts=0;
  manager.identity=async()=>{if(++attempts<3)throw new Error('SSH 操作超时。');return {user:'example',home:'/Users/example'};};
  await manager.connect();assert.equal(attempts,3);assert.equal(manager.connection.state,'connected');
  assert.equal(rpc.calls.some(c=>c.method==='turn/start'),false);
});

test('retry exhaustion and authentication failures end in a retryable error state',async(t)=>{
  for(const message of ['Operation timed out','Permission denied']){
    const {manager}=fixture(t);manager.disconnect();manager.retryDelays=[1,1];let attempts=0;
    manager.identity=async()=>{attempts++;throw new Error(message);};
    await assert.rejects(manager.connect(),new RegExp(message));
    assert.equal(attempts,message==='Permission denied'?1:3);assert.equal(manager.connection.state,'error');
  }
});

test('cancelling during retry backoff stops further connection attempts',async(t)=>{
  const {manager}=fixture(t);manager.disconnect();manager.retryDelays=[30000];let attempts=0;
  manager.identity=async()=>{attempts++;throw new Error('Operation timed out');};
  const waiting=new Promise(resolve=>{manager.on('event',e=>{if(e.method==='manager/status'&&e.params.connection.state==='reconnecting')resolve();});});
  const attempt=manager.connect();const cancelled=assert.rejects(attempt,/连接已取消/);await waiting;manager.disconnect();await cancelled;
  assert.equal(attempts,1);assert.equal(manager.connection.state,'disconnected');
});

test('unsupported operations are blocked while read-only history remains available',async(t)=>{
  const {manager,rpc}=fixture(t);manager.controlled.set('original',{});
  manager.service.protocolValidation={features:Object.fromEntries(['create','takeover','message','steer','stop','release','queue'].map(name=>[name,{supported:false,reason:'missing interface'}]))};
  for(const action of [()=>manager.newThread({cwd:'/Users/example/project'}),()=>manager.takeover('other'),()=>manager.message('original',{text:'hello'}),()=>manager.steer('original',{text:'hello'}),()=>manager.interrupt('original'),()=>manager.release({allEntrancesDisconnected:true})])await assert.rejects(action(),error=>error.code==='FEATURE_UNAVAILABLE');
  assert.equal(rpc.calls.length,0);
  const detail=await manager.detail('read-only');assert.equal(detail.controlled,false);assert.equal(detail.queue.error,'missing interface');
});

test('displayed engine version comes from the live handshake, separately from installed version',async(t)=>{
  const {manager,rpc}=fixture(t);manager.disconnect();
  rpc.connect=async()=>{rpc.connected=true;return {userAgent:'remote_codex_manager/0.162.0-alpha.17.2 (Mac OS)'};};
  manager.serviceAction=async action=>action==='projects'?{data:[]}:{pid:1,startedAt:'now',version:'0.163.0-alpha.10.2'};
  await manager.connect();assert.equal(manager.service.version,'0.162.0-alpha.17.2');assert.equal(manager.service.installedVersion,'0.163.0-alpha.10.2');
});

test('reconnect to a restarted service restores only explicitly subscribed threads', async (t) => {
  const { manager } = fixture(t);
  manager.connection.state = 'disconnected';
  await manager.connect();
  await manager.takeover('original');
  manager.disconnect();
  manager.serviceAction = async (action) => action === 'projects' ? { data: [] }
    : { running: true, pid: 123, version: '0.162.fake', startedAt: 'different-start' };
  const nextRPC = new FakeRPC();
  manager.rpcFactory = () => nextRPC;
  await manager.connect();
  assert.equal(manager.controlled.has('original'), true);
  assert.equal(nextRPC.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(nextRPC.calls.some(call => call.method === 'turn/start'), false);
});

test('release is refused for a running turn, active goal, background terminal, or approval', async (t) => {
  const cases = [
    { name: 'turn', handlers: { 'thread/read': async () => ({ thread: { id: 'original', status: { type: 'active' } } }) } },
    { name: 'goal', handlers: { 'thread/goal/get': async () => ({ goal: { status: 'active' } }) } },
    { name: 'background', handlers: { 'thread/backgroundTerminals/list': async () => ({ data: [{ processId: 'p1' }] }) } },
    { name: 'queued input', handlers: { 'thread/queue/list': async () => ({data:[{id:'queued'}],nextCursor:null}) } },
    { name: 'approval', pending: true },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const { manager, serviceCalls } = fixture(subtest, { 'thread/loaded/list': async () => ({ data: ['original'] }), ...scenario.handlers });
      if (scenario.pending) manager.onRequest(approval('pending'));
      await assert.rejects(manager.release({allEntrancesDisconnected:true}), (error) => error.code === 'SERVICE_BUSY' && error.details.some((entry) => entry.threadId === 'original'));
      assert.equal(serviceCalls.includes('release'), false);
      assert.equal(manager.connection.state, 'connected');
    });
  }
});

test('release stays connected when the queued input check fails or is malformed',async(t)=>{
  for(const handler of [async()=>{throw new Error('queue unavailable');},async()=>({})]){
    const {manager,serviceCalls}=fixture(t,{'thread/loaded/list':async()=>({data:['original']}),'thread/queue/list':handler});
    await assert.rejects(manager.release({allEntrancesDisconnected:true}));
    assert.equal(serviceCalls.includes('release'),false);
    assert.equal(manager.connection.state,'connected');
  }
});

test('intentional service shutdown does not trigger reconnect or retain a connection error', async (t) => {
  const {manager,rpc}=fixture(t);
  manager.serviceAction=async action=>{assert.equal(action,'release');rpc.connected=false;manager.onDisconnect('socket closed');return {running:false};};
  const result=await manager.release({allEntrancesDisconnected:true});
  assert.equal(result.connection.state,'disconnected');
  assert.equal(result.connection.error,null);
  assert.equal(result.service.running,false);
  assert.equal(manager.retry,null);
  assert.equal(result.errors.length,0);
});

test('release cannot race a newly submitted turn while its safety checks are pending', async (t) => {
  const enteredCheck = deferred();
  const finishCheck = deferred();
  const { manager } = fixture(t, {
    'thread/loaded/list': async () => ({ data: ['original'] }),
    'thread/backgroundTerminals/list': async () => { enteredCheck.resolve(); await finishCheck.promise; return { data: [] }; },
  });
  manager.controlled.set('original', { model: 'model-a', effort: 'high' });
  const releasing = manager.release({allEntrancesDisconnected:true});
  await enteredCheck.promise;
  try {
    await assert.rejects(manager.message('original', { text: 'must not start during release' }), (error) => error.status === 409);
  } finally {
    finishCheck.resolve();
    await releasing;
  }
});

test('release refuses to stop the service while an earlier mutation is still awaiting its RPC result', async (t) => {
  const enteredStart = deferred();
  const finishStart = deferred();
  const { manager, serviceCalls } = fixture(t, {
    'thread/loaded/list': async () => ({ data: ['original'] }),
    'turn/start': async () => { enteredStart.resolve(); return finishStart.promise; },
  });
  manager.controlled.set('original', { model: 'model-a', effort: 'high' });
  const sending = manager.message('original', { text: 'already being submitted' }).then((value) => ({ value }), (error) => ({ error }));
  await enteredStart.promise;
  try {
    await assert.rejects(manager.release({allEntrancesDisconnected:true}), (error) => error.status === 409);
    assert.equal(serviceCalls.includes('release'), false);
  } finally {
    finishStart.resolve({ turn: { id: 'in-flight-turn', status: 'inProgress' } });
    await sending;
  }
});

test('release skips only unsupported ephemeral goals and still checks remaining work',async(t)=>{
  const {manager,rpc,serviceCalls}=fixture(t,{'thread/loaded/list':()=>({data:['temporary']}),'thread/goal/get':()=>{throw new Error('ephemeral thread does not support goals: temporary');}});
  await manager.release({allEntrancesDisconnected:true});
  assert.ok(serviceCalls.includes('release'));
  assert.ok(rpc.calls.some(c=>c.method==='thread/queue/list'));
  assert.ok(rpc.calls.some(c=>c.method==='thread/backgroundTerminals/list'));
});
test('ephemeral goal exclusion never bypasses active turns or unknown goal failures',async(t)=>{
  for(const active of [true,false]){
    const {manager,serviceCalls}=fixture(t,{'thread/loaded/list':()=>({data:['temporary']}),'thread/read':()=>({thread:{status:{type:active?'active':'idle'}}}),'thread/goal/get':()=>{throw new Error(active?'ephemeral thread does not support goals: temporary':'network failure');}});
    await assert.rejects(manager.release({allEntrancesDisconnected:true}),e=>e.code===(active?'SERVICE_BUSY':'GOAL_CHECK_FAILED'));
    assert.ok(!serviceCalls.includes('release'));
  }
});
test('maintenance accepts the native ephemeral queue exclusion for release and login reload',async(t)=>{
  for(const reloadLogin of [false,true]){
    const {manager,rpc,serviceCalls}=fixture(t,{
      'thread/loaded/list':()=>({data:['temporary','ordinary']}),
      'thread/goal/get':({threadId})=>{if(threadId==='temporary')throw new Error('ephemeral thread does not support goals: temporary');return {goal:null};},
      'thread/queue/list':({threadId})=>{if(threadId==='temporary')throw new Error('ephemeral thread does not support queued submissions: temporary');return {data:[]};},
    });
    await manager.release({allEntrancesDisconnected:true},reloadLogin);
    assert.deepEqual(serviceCalls,[reloadLogin?'reload-login':'release']);
    assert.equal(rpc.calls.filter(c=>c.method==='thread/backgroundTerminals/list').length,2);
    assert.equal(rpc.calls.filter(c=>c.method==='thread/queue/list').length,2);
  }
});
test('ephemeral queue exclusion preserves maintenance blockers and fails closed on other errors',async(t)=>{
  const exclusion='ephemeral thread does not support queued submissions: temporary';
  const cases=[
    {'thread/read':()=>({thread:{status:{type:'active'}}})},
    {'thread/goal/get':()=>({goal:{status:'active'}})},
    {'thread/backgroundTerminals/list':()=>({data:[{processId:'background'}]})},
    {'thread/queue/list':()=>{throw new Error('network failure');}},
    {'thread/queue/list':()=>{throw new Error(exclusion+' extra failure');}},
    {'thread/queue/list':()=>{throw new Error('ephemeral thread does not support queued submissions: other');}},
    {'thread/queue/list':()=>({})},
  ];
  for(const reloadLogin of [false,true])for(const handlers of cases){
    const {manager,serviceCalls}=fixture(t,{
      'thread/loaded/list':()=>({data:['temporary']}),
      'thread/queue/list':()=>{throw new Error(exclusion);},...handlers,
    });
    await assert.rejects(manager.release({allEntrancesDisconnected:true},reloadLogin));
    assert.deepEqual(serviceCalls,[]);
    assert.equal(manager.connection.state,'connected');
    assert.equal(manager.releasing,false);
  }
});
test('decision answers require every question, preserve free text, and reject duplicate submission',t=>{
  const {manager,rpc}=fixture(t);
  manager.onRequest({id:'decision',method:'item/tool/requestUserInput',params:{threadId:'original',questions:[{id:'choice',question:'请选择',options:[{label:'继续'}]}]}});
  const key=approvalKey('decision');
  assert.throws(()=>manager.respond(key,{answers:{}}),/请回答所有问题/);
  assert.equal(rpc.responses.length,0);
  manager.respond(key,{answers:{choice:{answers:['  先核对日志，不执行发布  ']}}});
  assert.deepEqual(rpc.responses[0].result,{answers:{choice:{answers:['先核对日志，不执行发布']}}});
  assert.throws(()=>manager.respond(key,{answers:{}}),e=>e.code==='STALE_REQUEST');
});

test('stop terminates background commands after the model turn has completed',async t=>{
 const {manager,rpc}=fixture(t,{'thread/backgroundTerminals/list':()=>({data:[{processId:'background-1'}]})});
 manager.controlled.set('original',{});
 const result=await manager.interrupt('original');
 assert.deepEqual(result,{interrupted:false,terminated:['background-1']});
 assert.ok(rpc.calls.some(c=>c.method==='thread/backgroundTerminals/terminate'&&c.params.threadId==='original'&&c.params.processId==='background-1'));
});

test('detail backfills running command metadata and full journal output before completion',async t=>{
  const {manager}=fixture(t);
  manager.service.outputJournal=true;
  manager.controlled.set('original',{});
  manager.passive=async(action,payload)=>{
    if(action==='detail')return await rpc.request('thread/read',{threadId:payload.threadId});
    assert.equal(action,'history');assert.equal(payload.threadId,'original');assert.equal(payload.withOutputs,true);
    return {data:[{id:'turn-live',status:'inProgress',items:[{id:'command-live',type:'commandExecution',status:'inProgress',command:'loop',cwd:'/project',aggregatedOutput:'1\n2\n3\n'}]}],historySource:'snapshot'};
  };
  const result=await manager.detail('original');
  assert.equal(result.turns[0].status,'inProgress');
  assert.equal(result.turns[0].items[0].aggregatedOutput,'1\n2\n3\n');
  assert.equal(result.turns[0].items[0].command,'loop');
});

 test('resuming an idle thread clears a turn completed while disconnected', (t) => {
  const {manager}=fixture(t);
  manager.activeTurns.set('original','offline-turn');
  manager.rememberControl({thread:{id:'original',status:{type:'idle'}},model:'model-a',reasoningEffort:'high'});
  assert.equal(manager.activeTurns.has('original'),false);
  assert.equal(manager.controlled.get('original').effort,'high');
});

test('sending to an unloaded controlled thread resumes the same thread once',async(t)=>{
 const {manager,rpc}=fixture(t);
 manager.controlled.set('original',{model:'model-a',effort:'high',status:{type:'notLoaded'}});
 await manager.message('original',{text:'continue',model:'model-b',effort:'medium'});
 const calls=rpc.calls.filter(c=>['thread/resume','turn/start'].includes(c.method));
 assert.deepEqual(calls.map(c=>c.method),['thread/resume','turn/start']);
 assert.ok(calls.every(c=>c.params.threadId==='original'));
 assert.equal(calls[1].params.model,'model-b');
 assert.equal(calls[1].params.effort,'medium');
});


test('reconnect restores an unloaded subscription without rebroadcasting missed events',async(t)=>{
 const {manager}=fixture(t);manager.connection.state='disconnected';await manager.connect();await manager.takeover('original');
 manager.subscriptions.set('original',{since:100});manager.onDisconnect('test loss');clearTimeout(manager.retry);
 const next=new FakeRPC();next.handlers['thread/loaded/list']=async()=>({data:[]});
 next.handlers['thread/goal/get']=async()=>({goal:{createdAt:50,updatedAt:101,status:'complete'}});
 next.handlers['thread/turns/list']=async()=>({data:[{id:'missed',status:'failed',completedAt:102},{id:'old',status:'failed',completedAt:99}],nextCursor:null});
 const events=[];manager.on('event',e=>events.push(e));manager.rpcFactory=()=>next;await manager.connect();
 assert.equal(manager.controlled.has('original'),true);
 assert.equal(next.calls.filter(c=>c.method==='thread/resume').length,1);
 assert.equal(events.filter(e=>e.method==='thread/goal/updated').length,0);
 assert.deepEqual(events.filter(e=>e.method==='turn/completed'),[]);
 assert.ok([...manager.notices.values()].some(e=>e.params.turn?.id==='missed'));
 assert.equal(next.calls.some(c=>['turn/start','turn/steer','turn/interrupt'].includes(c.method)),false);
});
test('failed resume keeps the desired subscription for a later retry',async(t)=>{
 const {manager}=fixture(t);manager.connection.state='disconnected';await manager.connect();await manager.takeover('original');manager.disconnect();
 const next=new FakeRPC();next.handlers['thread/resume']=async()=>{throw Error('active writer');};manager.rpcFactory=()=>next;await manager.connect();
 assert.equal(manager.controlled.has('original'),false);assert.equal(manager.subscriptions.has('original'),true);
 delete next.handlers['thread/resume'];manager.disconnect();await manager.connect();assert.equal(manager.controlled.has('original'),true);
});

test('subscriptions and checkpoints survive manager process replacement',async(t)=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'rcm-subscription-'));t.diagnostic('Retained isolated fixture: '+dir);
 const store=join(dir,'titles.json');const before=new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore:store});
 before.rememberControl({thread:{id:'saved'},model:'m'});before.subscriptions.set('saved',{since:123});before.saveSubscriptions();
 const after=new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore:store});assert.deepEqual([...after.subscriptions],[['saved',{since:123}]]);
 assert.equal(after.controlled.size,0);
});
test('terminal notices survive restart, acknowledge durably, and ignore unknown threads', async t => {
  const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'rcm-notices-'));t.diagnostic('Retained isolated fixture: '+dir);
  const titleStore=join(dir,'titles.json');const a=new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore});a.subscriptions.set('t',{since:1});a.saveSubscriptions();
  a.publish('turn/completed',{threadId:'t',turn:{id:'ok',status:'completed'}});
  a.publish('turn/completed',{threadId:'unknown',turn:{id:'bad',status:'failed'}});
  a.publish('turn/completed',{threadId:'t',turn:{id:'fail',status:'failed'}});
  a.publish('turn/completed',{threadId:'t',turn:{id:'fail',status:'failed'}});
  const b=new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore});assert.equal(b.replayNotices().length,2);
  for(const notice of b.replayNotices())b.acknowledgeNotice(notice.params.key);
  assert.equal(new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore}).replayNotices().length,0);
  let connects=0;b.connect=()=>{connects++;};b.restoreConnection();assert.equal(connects,1);
  b.disconnect({preserveIntent:true});assert.equal(new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore}).restoreOnStart,true);
  b.disconnect();const c=new Manager({host:{id:"test",alias:"test",user:"example",home:"/Users/example"},titleStore});c.connect=()=>{connects++;};c.restoreConnection();assert.equal(connects,1);
});
test('steer passes reference context separately and never reloads the running thread',async(t)=>{
 const {manager,rpc}=fixture(t),id='00000000-0000-0000-0000-000000000001',target='00000000-0000-0000-0000-000000000002';
 manager.controlled.set(id,{});manager.activeTurns.set(id,'active-turn');
 manager.service.protocolValidation={features:{threadReferenceSteer:{supported:true}}};
 manager.references.prepare=async(caller,ids,options)=>{assert.equal(caller,id);assert.deepEqual(ids,[target]);assert.deepEqual(options,{allowReload:false});return [{threadId:target,title:'引用会话'}];};
 await manager.steer(id,{text:'原文 @引用会话',threads:[target]});
 const call=rpc.calls.find(c=>c.method==='turn/steer');assert.equal(call.params.expectedTurnId,'active-turn');assert.equal(call.params.input[0].text,'原文 @引用会话');assert.match(call.params.additionalContext['rcm.threadReferences'].value,new RegExp(target));
 assert.equal(rpc.calls.some(c=>['thread/resume','thread/unsubscribe','thread/goal/set'].includes(c.method)),false);
});
test('unverified reference steering fails before authorizing or submitting',async(t)=>{
 const {manager,rpc}=fixture(t),id='00000000-0000-0000-0000-000000000001';
 manager.controlled.set(id,{});manager.activeTurns.set(id,'active-turn');
 manager.references.prepare=()=>assert.fail('unverified capability');
 await assert.rejects(manager.steer(id,{text:'引用',threads:['00000000-0000-0000-0000-000000000002']}),e=>e.code==='FEATURE_UNAVAILABLE');
 assert.equal(rpc.calls.some(c=>c.method==='turn/steer'),false);
});
