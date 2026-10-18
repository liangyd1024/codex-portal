import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {RpcClient} from '../lib/rpc-client.mjs';
const model={id:'test-model',model:'test-model'};
const manager=rpc=>{const m=new Manager({host:{alias:'test'}});m.rpc=rpc;m.connection.state='connected';return m;};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

class SlowSocket extends EventTarget {
  readyState=1;
  send(raw) {
    const request=JSON.parse(raw);
    if (!request.id) return;
    const result=request.method==='initialize'?{}:{data:[model],nextCursor:null};
    const reply=()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,result})}));
    if(request.method==='initialize')queueMicrotask(reply);
    else setTimeout(reply,6000);
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
test('model catalog accepts an engine response later than five seconds',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const rpc=new RpcClient({WebSocketImpl:SlowSocket});await rpc.connect('ws://test');
  try {
    const m=manager(rpc);const read=m.refreshCatalog('models');
    t.mock.timers.tick(6000);
    assert.deepEqual(await read,[model]);assert.deepEqual(m.models,[model]);
  }finally{rpc.close();}
});
test('concurrent refreshes share the complete paginated read, then permit a fresh read',async()=>{
  const first=deferred();let calls=0;
  const rpc={connected:true,request:async(_method,params)=>{calls++;if(params.cursor)return {data:[{id:'second'}]};return first.promise;}};
  const m=manager(rpc);const a=m.refreshCatalog('models'),b=m.refreshCatalog('models');assert.equal(calls,1);
  first.resolve({data:[model],nextCursor:'page2'});
  assert.deepEqual(await a,await b);assert.equal(calls,2);assert.equal(m.models.length,2);
  await m.refreshCatalog('models');assert.equal(calls,4);
});
test('real deadline rejects, preserves the previous catalog, and permits retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  class StalledSocket extends SlowSocket {send(raw){if(JSON.parse(raw).method==='initialize')super.send(raw);}}
  const rpc=new RpcClient({WebSocketImpl:StalledSocket});await rpc.connect('ws://test');
  try{
    const m=manager(rpc);m.models=[model];
    const failure=assert.rejects(m.refreshCatalog('models'),e=>e.code==='RPC_TIMEOUT');
    t.mock.timers.tick(30000);await failure;assert.deepEqual(m.models,[model]);
    rpc.request=async()=>({data:[{id:'recovered'}]});
    assert.deepEqual(await m.refreshCatalog('models'),[{id:'recovered'}]);
  }finally{rpc.close();}
});
test('a late response from an old connection cannot overwrite the new catalog',async()=>{
  const old=deferred();const m=manager({connected:true,request:()=>old.promise});
  const stale=assert.rejects(m.refreshCatalog('models'),e=>e.code==='CONNECTION_CHANGED');
  m.generation++;m.rpc={connected:true,request:async()=>({data:[{id:'new'}]})};
  await m.refreshCatalog('models');old.resolve({data:[model]});await stale;
  assert.deepEqual(m.models,[{id:'new'}]);
});
test('disconnect during a refresh preserves the existing catalog',async()=>{
  const pending=deferred();const m=manager({connected:true,request:()=>pending.promise});m.models=[model];
  const failure=assert.rejects(m.refreshCatalog('models'),e=>e.code==='DISCONNECTED');
  m.connection.state='disconnected';pending.resolve({data:[]});await failure;
  assert.deepEqual(m.models,[model]);
});
