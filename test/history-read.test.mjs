import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';

const unavailable=()=>Error('unable to open database file');
const turn=()=>({id:'turn',status:'completed',items:[{id:'reply',type:'agentMessage',text:'原始回复'}]});
function fixture(){
  const calls=[],m=new Manager({host:{alias:'test'}});
  m.connection.state='connected';m.service.protocolValidation={unsupportedMethods:[]};
  m.passive=async()=>{throw unavailable();};
  m.rpc={connected:true,request:async(method,params)=>{
    calls.push([method,params]);return {data:[turn()],nextCursor:null};
  }};
  return {m,calls};
}
test('readable snapshots stay passive, including desktop and handed-off sessions',async()=>{
  const {m,calls}=fixture();
  m.passive=async()=>({data:[turn()],nextCursor:'db:12',historySource:'snapshot'});
  m.subscriptions.set('desktop',{handoff:{state:'released'}});
  const result=await m.history('desktop');
  assert.equal(result.nextCursor,'db:12');assert.equal(result.historySource,'snapshot');assert.deepEqual(calls,[]);
});
test('unreadable history uses full native messages without taking ownership',async()=>{
  const {m,calls}=fixture();m.subscriptions.set('desktop',{handoff:{state:'released'}});
  const result=await m.history('desktop');
  assert.equal(result.data[0].items[0].text,'原始回复');assert.equal(result.historySource,'protocol');
  assert.deepEqual(calls,[['thread/turns/list',{threadId:'desktop',limit:5,sortDirection:'desc',itemsView:'full'}]]);
  assert.equal(m.controlled.size,0);assert.equal(m.subscriptions.get('desktop').handoff.state,'released');
});
test('native pagination stays native even when the snapshot becomes readable',async()=>{
  const {m,calls}=fixture();let reads=0;
  m.passive=async()=>{reads++;if(reads===1)throw unavailable();assert.fail('native cursor must not enter SQLite');};
  const rawCursor='{"rolloutOrdinal":24,"scope":{"kind":"turns"}}';
  m.rpc.request=async(method,p)=>{calls.push([method,p]);return {data:[turn()],nextCursor:p.cursor?null:rawCursor};};
  const first=await m.history('t'),second=await m.history('t',first.nextCursor);
  assert.equal(reads,1);assert.equal(calls[1][1].cursor,rawCursor);assert.equal(second.nextCursor,null);
});
test('an unreadable older snapshot page asks for refresh instead of mixing cursor formats',async()=>{
  const {m,calls}=fixture();
  await assert.rejects(m.history('t','db:12'),e=>e.code==='HISTORY_CURSOR_CHANGED');
  assert.deepEqual(calls,[]);
  await assert.rejects(m.history('t','native:'),e=>e.code==='HISTORY_CURSOR_CHANGED');
});
test('unrelated snapshot errors and unsupported native reads remain visible',async()=>{
  for(const unsupported of [false,true]){
    const {m,calls}=fixture();
    if(unsupported)m.service.protocolValidation.unsupportedMethods=['thread/turns/list'];
    else m.passive=async()=>{throw Error('invalid history JSON');};
    await assert.rejects(m.history('t'),unsupported?/unable to open/:/invalid history/);assert.deepEqual(calls,[]);
  }
});
test('native timeouts and invalid results do not become empty successful histories',async()=>{
  for(const result of [Error('native timeout'),{}, {data:[{id:'t'}]}, {data:[turn()],nextCursor:12}]){
    const {m}=fixture();m.rpc.request=async()=>{if(result instanceof Error)throw result;return result;};
    await assert.rejects(m.history('t'),result instanceof Error?/native timeout/:/返回格式无效/);
  }
});
test('late native and journal responses cannot escape into a different connection',async()=>{
  for(const stage of ['native','journal']){
    const {m}=fixture();let release;
    const wait=new Promise(resolve=>release=resolve);
    if(stage==='native')m.rpc.request=async()=>{await wait;return {data:[turn()]};};
    else m.passive=async action=>{if(action==='history')throw unavailable();await wait;return {data:[]};};
    const pending=m.history('t',undefined,true);
    const rejected=assert.rejects(pending,e=>e.code==='CONNECTION_CHANGED');
    await new Promise(resolve=>setImmediate(resolve));m.generation++;release();await rejected;
  }
});
test('native recovery retains command-output deltas and all original message items',async()=>{
  const {m}=fixture();const versions={command:'5:hash'};
  m.rpc.request=async()=>({data:[{...turn(),items:[...turn().items,{id:'command',type:'commandExecution',aggregatedOutput:'native output'}]}]});
  m.passive=async(action,p)=>{
    if(action==='history')throw unavailable();
    assert.equal(action,'outputs');assert.deepEqual(p.turnIds,['turn']);assert.deepEqual(p.outputVersions,versions);
    return {data:[{turnId:'turn',item:{id:'command',type:'commandExecution',outputBaseToken:'5:hash',outputDelta:' new',outputToken:'9:hash2'}}]};
  };
  const result=await m.history('t',undefined,true,versions);
  assert.equal(result.data[0].items[0].text,'原始回复');
  const command=result.data[0].items[1];assert.equal(command.outputDelta,' new');assert.equal(command.aggregatedOutput,undefined);
});
test('preview bounds command output but keeps the complete assistant message',async()=>{
  const {m}=fixture();const text='a'.repeat(20000);
  m.rpc.request=async()=>({data:[{id:'t',items:[{type:'agentMessage',text},{type:'commandExecution',aggregatedOutput:text}]}]});
  const result=await m.history('t',undefined,false,{},true);
  assert.equal(result.data[0].items[0].text,text);assert.equal(result.data[0].items[1].aggregatedOutput.length,16384);
  assert.equal(result.data[0].items[1].outputPartial,true);
});
