import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {summarizeTitle} from '../lib/thread-title.mjs';
import {setGoal} from '../lib/composer.mjs';
import {Manager} from '../lib/manager.mjs';

function setup({titleStore=null,read,write,send,goal}={}) {
  const calls=[];
  const m=new Manager({host:{alias:'test'},titleStore});
  m.connection.state='connected';
  m.rpc={connected:true,async request(method,params){
    calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='thread/start')return {thread:{id:'t',cwd:'/project',status:{type:'idle'}}};
    if(method==='turn/start')return send?send():{turn:{id:'turn',status:'completed'}};
    if(method==='thread/goal/set')return goal?goal():{goal:{objective:params.objective,status:'active'}};
    if(method==='thread/read')return read?read():{thread:{id:'t',name:null}};
    if(method==='thread/name/set')return write?write():{};
    throw Error('Unexpected RPC: '+method);
  }};
  return {m,calls};
}
const flush=async m=>{await Promise.all([...m.titleJobs.values()]);};

test('extracts actionable text, removes formatting and preserves identifiers and negation',()=>{
  assert.equal(summarizeTitle('你好。\n```js\nthrow Error("noise")\n```\n请修复 **ABC-123**，不要删除 `user_state.json`'), '修复 ABC-123，不要删除 user_state.json');
  assert.equal(summarizeTitle('帮我排查一下，手机端中文回车误发送，谢谢'),'排查手机端中文回车误发送');
  assert.equal(summarizeTitle('请检查 [RPC](https://example.com) 连接失败'),'检查 RPC 连接失败');
  assert.equal(summarizeTitle(''), '新会话');
  assert.equal(summarizeTitle('',{hasImages:true}), '图片会话');
  const long=summarizeTitle('修复'+ '😀'.repeat(60));
  assert.equal(Array.from(long).length,36);assert.ok(long.endsWith('…'));assert.ok(!/[\uD800-\uDBFF]$/.test(long.slice(0,-1)));
});
test('titles the first accepted message once without an extra model thread or turn',async()=>{
  const {m,calls}=setup();await m.newThread({cwd:'/project'});
  await m.message('t',{text:'请修复首次发送失败'});await flush(m);
  m.onNotification({method:'turn/completed',params:{threadId:'t',turn:{id:'turn',status:'completed'}}});
  await m.message('t',{text:'现在修改另一个功能'});await flush(m);
  assert.equal(calls.filter(c=>c.method==='thread/start').length,1);
  assert.equal(calls.filter(c=>c.method==='turn/start').length,2);
  assert.deepEqual(calls.filter(c=>c.method==='thread/name/set').map(c=>c.params.name),['修复首次发送失败']);
});
test('failed message keeps eligibility; title failure does not reject or retry the accepted message',async()=>{
  let fail=true;const {m,calls}=setup({send:()=>{if(fail)throw Error('send rejected');return {turn:{id:'ok',status:'completed'}};},write:()=>{throw Error('title unavailable');}});
  await m.newThread({cwd:'/project'});
  await assert.rejects(m.message('t',{text:'失败消息'}),/send rejected/);assert.equal(m.autoTitles.get('t').pendingFirstMessage,true);
  fail=false;await m.message('t',{text:'已接受消息'});await flush(m);
  await m.message('t',{text:'第二轮'});await flush(m);
  assert.equal(calls.filter(c=>c.method==='thread/name/set').length,1);
  assert.equal(m.errors.at(-1).stage,'自动命名');
});
test('existing engine title, manual rename, and connection changes prevent late auto writes',async()=>{
  for(const action of ['existing','manual','connection']){
    let resolve;const pending=new Promise(r=>resolve=r);
    const {m,calls}=setup({read:()=>pending});await m.newThread({cwd:'/project'});
    await m.message('t',{text:'修复问题'});
    if(action==='manual')m.autoTitles.get('t').manual=true;
    if(action==='connection')m.generation++;
    resolve({thread:{name:action==='existing'?'桌面命名':null}});await flush(m);
    assert.equal(calls.filter(c=>c.method==='thread/name/set').length,0,action);
  }
});
test('legacy titles are preserved and completed first-message state survives restart',async(t)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rcm-title-'));t.diagnostic('保留测试目录：'+dir);
  const titleStore=path.join(dir,'titles.json');const {m,calls}=setup({titleStore});
  await m.newThread({cwd:'/project'});await m.message('t',{text:'首次任务'});await flush(m);
  assert.equal(JSON.parse(readFileSync(titleStore))[0][1].pendingFirstMessage,false);
  const restored=setup({titleStore});restored.m.controlled.set('t',{cwd:'/project',status:{type:'idle'}});
  await restored.m.message('t',{text:'后续任务'});await flush(restored.m);
  assert.ok(!restored.calls.some(c=>c.method==='thread/name/set'));
  m.autoTitles.set('legacy',{context:['旧内容'],lastTitle:'已有标题'});m.controlled.set('legacy',{cwd:'/project',status:{type:'idle'}});
  await m.message('legacy',{text:'新的内容'});await flush(m);
  assert.equal(m.autoTitles.get('legacy').lastTitle,'已有标题');
  assert.equal(calls.filter(c=>c.method==='thread/name/set').length,1);
});
test('explicitly named chats never auto-name',async()=>{
  const {m,calls}=setup();await m.newThread({cwd:'/project',name:'手动标题'});
  await m.message('t',{text:'不同的话题'});await flush(m);
  assert.deepEqual(calls.filter(c=>c.method==='thread/name/set').map(c=>c.params.name),['手动标题']);
});

test('empty rollout during startup retries metadata only and preserves a later desktop title',async()=>{
  for(const existing of [null,'桌面标题']){
    let reads=0;
    const {m,calls}=setup({read:()=>{if(++reads<3)throw Error('failed to read thread: rollout at /tmp/new.jsonl is empty');return {thread:{name:existing}};}});
    await m.newThread({cwd:'/project'});await m.message('t',{text:'修复启动问题'});await flush(m);
    assert.equal(reads,3);assert.equal(m.errors.length,0);
    assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
    assert.equal(calls.filter(c=>c.method==='thread/name/set').length,existing?0:1);
  }
});
test('metadata retries stop after connection changes and do not hide permanent failures',async()=>{
  for(const mode of ['connection','permanent','exhausted']){
    const {m,calls}=setup({read:()=>{if(mode==='connection')m.generation++;throw Error(mode==='permanent'?'permission denied':'rollout at /tmp/new.jsonl is empty');}});
    await m.newThread({cwd:'/project'});await m.message('t',{text:'修复启动问题'});await flush(m);
    assert.equal(calls.filter(c=>c.method==='thread/read').length,mode==='exhausted'?5:1);
    assert.equal(calls.filter(c=>c.method==='thread/name/set').length,0);
    assert.equal(m.errors.length,mode==='connection'?0:1);
  }
});

test('goal-first conversation names from the accepted objective without starting an extra turn',async()=>{
  const {m,calls}=setup();await m.newThread({cwd:'/project'});
  await setGoal(m,'t',{objective:'请修复目标模式标题',status:'active'});await flush(m);
  await m.message('t',{text:'后续回复'});await flush(m);
  assert.deepEqual(calls.filter(c=>c.method==='thread/name/set').map(c=>c.params.name),['修复目标模式标题']);
  assert.equal(calls.filter(c=>c.method==='thread/goal/set').length,1);
  assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
  assert.equal(m.autoTitles.get('t').pendingFirstMessage,false);
});
test('goal failure preserves naming eligibility and naming failure does not resend the goal',async()=>{
  let fail=true;
  const {m,calls}=setup({goal:()=>{if(fail)throw Error('goal rejected');return {goal:{status:'active'}};},write:()=>{throw Error('name rejected');}});
  await m.newThread({cwd:'/project'});
  await assert.rejects(setGoal(m,'t',{objective:'目标'}),/goal rejected/);
  assert.equal(m.autoTitles.get('t').pendingFirstMessage,true);
  fail=false;await setGoal(m,'t',{objective:'目标'});await flush(m);
  assert.equal(calls.filter(c=>c.method==='thread/goal/set').length,2);
  assert.equal(calls.filter(c=>c.method==='thread/name/set').length,1);
  assert.equal(m.errors.at(-1).stage,'自动命名');
});
test('goal naming preserves native names and ignores late responses after connection replacement',async()=>{
  for(const mode of ['named','connection']){
    const {m,calls}=setup({read:()=>({thread:{name:'已有名称'}}),goal:()=>{if(mode==='connection')m.generation++;return {goal:{status:'active'}};}});
    await m.newThread({cwd:'/project'});await setGoal(m,'t',{objective:'新目标'});await flush(m);
    assert.equal(calls.filter(c=>c.method==='thread/name/set').length,0);
    if(mode==='connection')assert.equal(m.autoTitles.get('t').pendingFirstMessage,true);
  }
});
