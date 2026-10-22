import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const tick=()=>new Promise(r=>setImmediate(r));
function loader(readThreads){const state={status:{instanceId:'one',connection:{connectedAt:1}},search:'',selectedId:'a'};const c=vm.createContext({state,readThreads});vm.runInContext(source.slice(source.indexOf('let listRead;'),source.indexOf('async function readThreads(')),c);return {state,load:(...args)=>c.loadThreads(...args)};}
test('same sidebar reads share work while explicit refresh queues a fresh read',async()=>{
 const d=gate();let calls=0;const f=loader(()=>++calls===1?d.promise:Promise.resolve());const a=f.load(),b=f.load(),fresh=f.load(false,true,true);assert.equal(calls,1);d.resolve();await Promise.all([a,b,fresh]);assert.equal(calls,2);
 const d2=gate(),g=loader(()=>d2.promise);const silent=g.load(),visible=g.load(false,true);d2.reject(Error('unavailable'));await silent;await assert.rejects(visible,/unavailable/);
});
test('sidebar search and connection changes never share an old pending read',async()=>{
 let calls=0;const d=gate(),f=loader(()=>{calls++;return d.promise;});const a=f.load();f.state.search='new';const b=f.load();f.state.status.connection.connectedAt=2;const c=f.load();assert.equal(calls,3);d.resolve();await Promise.all([a,b,c]);
});
test('late activity is ignored after a new snapshot, account, disconnect or connection generation',async()=>{
 for(const change of ['snapshot','account','disconnect','connection','none']){
  const d=gate(),snapshot={accountScope:'account',data:[{id:'a'}]},state={listVersion:1,sidebar:snapshot,threads:[{id:'a'}],status:{instanceId:'one',connection:{connectedAt:1}}};let connected=true,renders=0;
  const c=vm.createContext({state,connected:()=>connected,api:()=>d.promise,URLSearchParams,renderThreads:()=>renders++,recordError(){}});
  vm.runInContext(source.slice(source.indexOf('async function loadSidebarActivity('),source.indexOf('function loadVisibleThreads()')),c);
  const pending=c.loadSidebarActivity(snapshot,1);await tick();
  if(change==='snapshot')state.sidebar={...snapshot};if(change==='disconnect')connected=false;if(change==='connection')state.status.connection.connectedAt=2;
  d.resolve({accountScope:change==='account'?'other':'account',data:[{id:'a',activity:{observedAt:123}}]});await pending;
  assert.equal(renders,change==='none'?1:0);assert.equal(state.threads[0].activity?.observedAt,change==='none'?123:undefined);
 }
});
