import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {permissionParams,turnOptions,setGoal,composerCatalog} from '../lib/composer.mjs';

function fixture(){
  const m=new Manager({host:{alias:'test'}}),calls=[];
  m.connection={state:'connected'};m.service={protocolValidation:{features:{create:{supported:true},message:{supported:true}}}};
  m.rpc={connected:true,request:async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/start')return {thread:{id:'new',cwd:'/project',status:{type:'idle'}},model:'test'};
    if(method==='turn/start')return {turn:{id:'turn',status:'inProgress'}};
    if(method==='skills/list')return {data:[{skills:[{name:'skill',path:'/skills/SKILL.md',enabled:true}]}]};
    if(method==='plugin/installed')return {marketplaces:[{plugins:[{id:'plugin',name:'插件',installed:true,enabled:true}]}]};
    return {};
  }};
  return {m,calls};
}
test('full access applies to creation and turns, can be returned to default, rejects invalid modes',async()=>{
  const {m,calls}=fixture();await m.newThread({cwd:'/project',access:'full'});
  const start=calls.find(c=>c.method==='thread/start');assert.equal(start.params.approvalPolicy,'never');assert.equal(start.params.sandbox,'danger-full-access');
  await m.message('new',{text:'test',access:'full',mode:'plan'});
  const turn=calls.find(c=>c.method==='turn/start').params;
  assert.equal(turn.approvalPolicy,'never');assert.equal(turn.sandboxPolicy.type,'dangerFullAccess');assert.equal(turn.collaborationMode.mode,'plan');
  assert.equal(permissionParams('default').sandboxPolicy.type,'workspaceWrite');assert.equal(permissionParams('default').approvalPolicy,'on-request');
  assert.throws(()=>permissionParams('invalid'));
  await assert.rejects(turnOptions(m,'new',{mode:'invented'},{}));
});
test('skills and plugins are resolved against target catalogs, not arbitrary browser paths',async()=>{
  const {m}=fixture();m.controlled.set('a',{cwd:'/project',model:'test'});
  const options=await turnOptions(m,'a',{skills:['/skills/SKILL.md'],plugins:['plugin']},{});
  assert.deepEqual(options.input[0],{type:'skill',name:'skill',path:'/skills/SKILL.md'});
  assert.deepEqual(options.input[1],{type:'mention',name:'插件',path:'plugin://plugin'});
  await assert.rejects(turnOptions(m,'a',{skills:['/arbitrary/file']},{}),/不可用/);
  await assert.rejects(turnOptions(m,'a',{plugins:['missing']},{}),/不可用/);
});
test('goal uses explicit user origin and rejects busy threads and invalid budgets',async()=>{
  const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
  await setGoal(m,'a',{objective:'目标',tokenBudget:2000});
  assert.deepEqual(calls.find(c=>c.method==='thread/goal/set').params,{threadId:'a',objective:'目标',tokenBudget:2000,origin:'user'});
  await assert.rejects(setGoal(m,'a',{objective:'x',tokenBudget:-1}));
  m.activeTurns.set('a','turn');await assert.rejects(setGoal(m,'a',{status:'active'}),e=>e.code==='THREAD_BUSY');
});
test('continuing a blocked goal delegates to the native engine without starting a duplicate turn',async()=>{
  const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
  await setGoal(m,'a',{status:'active'});
  assert.deepEqual(calls,[{method:'thread/goal/set',params:{threadId:'a',origin:'user',status:'active'}}]);
});
test('only known newly created threads fall back when a durable state row is not present',async()=>{
  const {m}=fixture();await m.newThread({cwd:'/project'});
  m.passive=async()=>{throw Error('未找到会话：new');};
  assert.equal((await m.readThreadMetadata('new',true)).thread.id,'new');
  await assert.rejects(m.readThreadMetadata('unknown',true));
  m.passive=async()=>{throw Error('database is locked');};await assert.rejects(m.readThreadMetadata('new',true),/database is locked/);
  m.passive=async()=>({thread:{id:'new',name:'persisted'}});
  assert.equal((await m.readThreadMetadata('new',true)).thread.name,'persisted');assert.equal(m.createdSnapshots.has('new'),false);
});
test('a create timeout has an unknown outcome and is never retried automatically',async()=>{
  const {m}=fixture();let calls=0;m.rpc.request=async method=>{if(method==='account/read')return {};calls++;throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});};
  await assert.rejects(m.newThread({cwd:'/project'}),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(calls,1);
});
test('optional goal timeout does not report the whole conversation as failed or emit repeated error toasts',async()=>{
  const {m}=fixture();m.controlled.set('a',{cwd:'/project',status:{type:'idle'}});
  m.passive=async action=>action==='detail'?{thread:{id:'a'}}:{data:[],historySource:'snapshot'};
  m.rpc.request=async method=>{if(method==='thread/goal/get')throw Error('goal timeout');if(method==='thread/read')return {thread:{id:'a'}};return {data:[]};};
  for(let i=0;i<2;i++){const detail=await m.detail('a');assert.equal(detail.thread.id,'a');assert.equal(detail.goalError,'goal timeout');assert.equal(detail.goal,null);}
  assert.equal(m.errors.length,0);
});
test('session approval is forwarded only when explicitly offered by the engine',()=>{
 const {m}=fixture();const replies=[];m.rpc.respond=(id,result)=>replies.push(result);
 m.requests.set('approval',{id:1,kind:'approval',params:{availableDecisions:['accept','acceptForSession','cancel']}});
 m.respond('approval',{decision:'acceptForSession'});assert.equal(replies[0].decision,'acceptForSession');
 m.requests.set('approval',{id:2,kind:'approval',params:{availableDecisions:['accept','cancel']}});
 assert.throws(()=>m.respond('approval',{decision:'acceptForSession'}),/未提供/);assert.equal(replies.length,1);
});

test('catalog reads only the requested kind and shares pending reads per project',async()=>{
 const {m,calls}=fixture();const [a,b]=await Promise.all([composerCatalog(m,'/project','skills'),composerCatalog(m,'/project','skills')]);
 assert.deepEqual(a,b);assert.deepEqual(calls.map(c=>c.method),['skills/list']);
 await composerCatalog(m,'/project','skills');assert.equal(calls.length,1);
 await composerCatalog(m,'/other','skills');assert.equal(calls.length,2);
 await composerCatalog(m,'/project','plugins');assert.equal(calls.length,3);
 await assert.rejects(composerCatalog(m,'/project','invalid'));
});
test('failed catalogs are retryable, replacement connections do not reuse data',async()=>{
 const {m}=fixture();let calls=0;m.rpc.request=async()=>{calls++;if(calls===1)throw Error('timeout');return {data:[]};};
 assert.match((await composerCatalog(m,'/project','skills')).skills.error,/timeout/);
 assert.deepEqual((await composerCatalog(m,'/project','skills')).skills,{data:[]});assert.equal(calls,2);
 m.rpc={connected:true,request:async()=>({data:['new connection']})};
 assert.deepEqual((await composerCatalog(m,'/project','skills')).skills.data,['new connection']);
});
test('sending revalidates cached capabilities and preserves read failure semantics',async()=>{
 const {m}=fixture();m.controlled.set('a',{cwd:'/project',model:'test'});
 await composerCatalog(m,'/project','skills');m.rpc.request=async()=>{throw Error('offline');};
 await assert.rejects(turnOptions(m,'a',{skills:['/skills/SKILL.md']},{}),/暂时无法读取/);
});
test('running-turn steering includes verified skills and plugins without changing turn settings',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{cwd:'/project',status:{type:'active'}});m.activeTurns.set('a','running');
 await m.steer('a',{text:'请用 $skill 补充验证',skills:['/skills/SKILL.md'],plugins:['plugin'],mode:'plan',access:'full'});
 const request=calls.find(c=>c.method==='turn/steer').params;
 assert.equal(request.expectedTurnId,'running');assert.equal(request.input[0].text,'请用 $skill 补充验证');assert.deepEqual(request.input[1],{type:'skill',name:'skill',path:'/skills/SKILL.md'});assert.deepEqual(request.input[2],{type:'mention',name:'插件',path:'plugin://plugin'});
 assert.equal(request.collaborationMode,undefined);assert.equal(request.approvalPolicy,undefined);assert.equal(calls.some(c=>c.method==='turn/start'),false);
});
test('running skill selection rejects stale paths and connection changes before steering',async()=>{
 for(const scenario of ['missing','connection']){
  const {m,calls}=fixture();m.controlled.set('a',{cwd:'/project',status:{type:'active'}});m.activeTurns.set('a','running');
  const request=m.rpc.request;m.rpc.request=async(method,params)=>{const result=await request(method,params);if(scenario==='connection'&&method==='skills/list')m.generation++;return result;};
  await assert.rejects(m.steer('a',{text:'use skill',skills:[scenario==='missing'?'/untrusted':'/skills/SKILL.md']}));assert.equal(calls.some(c=>c.method==='turn/steer'),false);
 }
});

test('editing a running goal follows native active status without replacing its budget',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'active'}});m.activeTurns.set('a','turn');
 const request=m.rpc.request;m.rpc.request=async(method,params)=>method==='thread/goal/get'?{goal:{objective:'原目标',status:'active',tokenBudget:500}}:request(method,params);
 await setGoal(m,'a',{objective:' 新目标 ',expectedObjective:'原目标'});
 assert.deepEqual(calls,[{method:'thread/goal/set',params:{threadId:'a',origin:'user',objective:'新目标',status:'active'}}]);
 await assert.rejects(setGoal(m,'a',{objective:'旧修改',expectedObjective:'过期目标'}),e=>e.code==='GOAL_CHANGED');
 await assert.rejects(setGoal(m,'a',{objective:'新目标',expectedObjective:'原目标',status:'active'}),/参数无效/);
 assert.equal(calls.length,1);
 m.rpc.request=async()=>({goal:null});await assert.rejects(setGoal(m,'a',{objective:'新目标',expectedObjective:'原目标'}),e=>e.code==='GOAL_CHANGED');
 m.rpc.request=async()=>{throw Error('offline');};await assert.rejects(setGoal(m,'a',{objective:'新目标',expectedObjective:'原目标'}),/offline/);
});

test('goal toolbar clears the native goal during a turn and never deletes the conversation',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'active'}});m.activeTurns.set('a','turn');
 await setGoal(m,'a',{clear:true});
 assert.deepEqual(calls,[{method:'thread/goal/clear',params:{threadId:'a',origin:'user'}}]);
 for(const data of [{clear:false},{clear:true,status:'complete'},{clear:true,objective:'x'},{clear:true,tokenBudget:1}])await assert.rejects(setGoal(m,'a',data));
 assert.equal(calls.length,1);
});
test('goal pause during a running turn uses native status without interrupting the turn',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'active'}});m.activeTurns.set('a','turn');
 await setGoal(m,'a',{status:'paused'});
 assert.deepEqual(calls,[{method:'thread/goal/set',params:{threadId:'a',origin:'user',status:'paused'}}]);
});
test('goal clear respects unsupported engines, control ownership and RPC errors',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
 m.service.protocolValidation.features.goalClear={supported:false,reason:'missing'};
 await assert.rejects(setGoal(m,'a',{clear:true}),e=>e.code==='FEATURE_UNAVAILABLE');assert.equal(calls.length,0);
 m.service.protocolValidation.features.goalClear.supported=true;
 m.rpc.request=async()=>{throw Error('disconnected');};await assert.rejects(setGoal(m,'a',{clear:true}),/disconnected/);
 await assert.rejects(setGoal(m,'unknown',{clear:true}));
});

test('unchanged goal edits read native state without creating another goal message',async()=>{
 for(const status of ['active','blocked','paused','complete']){
  const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
  const goal={objective:'核实\n结果',status,tokensUsed:123,tokenBudget:500,updatedAt:100};
  m.rpc.request=async(method,params)=>{calls.push({method,params});return {goal};};
  const result=await setGoal(m,'a',{objective:'  核实\n结果\n',expectedObjective:goal.objective});
  assert.deepEqual(result,{goal});assert.deepEqual(calls,[{method:'thread/goal/get',params:{threadId:'a'}}]);
 }
});
test('unchanged edit still detects stale state; internal whitespace remains a real edit',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
 const request=m.rpc.request;m.rpc.request=async(method,params)=>method==='thread/goal/get'?{goal:{objective:'当前目标',status:'blocked'}}:request(method,params);
 await assert.rejects(setGoal(m,'a',{objective:'旧目标',expectedObjective:'旧目标'}),e=>e.code==='GOAL_CHANGED');assert.equal(calls.length,0);
 await setGoal(m,'a',{objective:'当前 目标',expectedObjective:'当前目标'});
 assert.equal(calls.length,1);assert.equal(calls[0].params.objective,'当前 目标');
});

test('editing paused or blocked goals resumes through the native goal request only',async()=>{
 for(const status of ['paused','blocked','budgetLimited','usageLimited']){
  const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
  const request=m.rpc.request;m.rpc.request=async(method,params)=>method==='thread/goal/get'?{goal:{objective:'原目标',status,tokenBudget:500}}:request(method,params);
  await setGoal(m,'a',{objective:'调整后的目标',expectedObjective:'原目标'});
  assert.deepEqual(calls,[{method:'thread/goal/set',params:{threadId:'a',origin:'user',objective:'调整后的目标',status:'active'}}]);
 }
});

test('creation path cannot overwrite an existing goal, including completed or limited goals',async()=>{
 for(const status of ['active','paused','blocked','budgetLimited','usageLimited','complete']){
  const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
  m.rpc.request=async(method,params)=>{calls.push({method,params});return {goal:{objective:'保持原目标',status}};};
  await assert.rejects(setGoal(m,'a',{objective:'补充内容',status:'active'}),e=>e.code==='GOAL_EXISTS');
  assert.deepEqual(calls,[{method:'thread/goal/get',params:{threadId:'a'}}]);
 }
});
test('goal creation read failure never falls through to a write',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
 m.rpc.request=async method=>{calls.push(method);throw Error('offline');};
 await assert.rejects(setGoal(m,'a',{objective:'补充内容'}),/offline/);
 assert.deepEqual(calls,['thread/goal/get']);
});

test('legacy goal mutations omit only the unsupported provenance parameter',async()=>{
 const {m,calls}=fixture();m.controlled.set('a',{status:{type:'idle'}});
 m.service.protocolValidation.optionalParams={'thread/goal/set':{origin:false},'thread/goal/clear':{origin:false}};
 const request=m.rpc.request;m.rpc.request=async(method,params)=>method==='thread/goal/get'?{goal:null}:request(method,params);
 await setGoal(m,'a',{objective:'兼容目标',tokenBudget:500});
 await setGoal(m,'a',{status:'paused'});
 await setGoal(m,'a',{clear:true});
 assert.deepEqual(calls,[{method:'thread/goal/set',params:{threadId:'a',objective:'兼容目标',tokenBudget:500}},{method:'thread/goal/set',params:{threadId:'a',status:'paused'}},{method:'thread/goal/clear',params:{threadId:'a'}}]);
 m.service.protocolValidation.optionalParams['thread/goal/set'].origin=true;
 await setGoal(m,'a',{status:'paused'});assert.equal(calls.at(-1).params.origin,'user');
});
