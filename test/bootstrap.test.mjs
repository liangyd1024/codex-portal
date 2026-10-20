import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// Substitute only the module transport so startup hangs/errors are deterministic.
const source=(await readFile(new URL('../public/bootstrap.js',import.meta.url),'utf8')).replace("import('./app.js')",'loadApp()');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(loadApp,fetch=async()=>new Response('{}')){
 const nodes=Object.fromEntries(['startup-status','startup-title','startup-message','startup-retry'].map(id=>[id,{hidden:false,setAttribute(name,value){this[name]=value;}}]));
 const events={},timers=new Map(),state={reloads:0};let seq=0;
 const document={body:{classList:{remove(){}}},hidden:false,getElementById:id=>nodes[id],addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(source,{document,window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true},location:{reload:()=>state.reloads++},setTimeout:(fn)=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),loadApp,fetch,AbortController});
 return {nodes,events,timers,state,document};
}
test('stalled startup offers retry and resumes when network returns',async()=>{
 const f=fixture(()=>new Promise(()=>{}));[...f.timers.values()][0]();
 assert.match(f.nodes['startup-message'].textContent,/超时/);f.events.online();await tick();assert.equal(f.state.reloads,1);
});
test('late successful initialization removes error and never reloads an interactive draft',()=>{
 const f=fixture(()=>new Promise(()=>{}));[...f.timers.values()][0]();f.events['rcm-ready']();
 assert.equal(f.nodes['startup-status'].hidden,true);f.events.online();f.events.pageshow();assert.equal(f.state.reloads,0);assert.equal(f.timers.size,0);
});
test('failed module loading checks expired pairing and redirects only for a confirmed auth failure',async()=>{
 const f=fixture(()=>Promise.reject(Error('module unavailable')),async()=>new Response(JSON.stringify({error:{code:'PAIRING_REQUIRED'}}),{status:401}));await tick();assert.equal(f.state.reloads,1);
 const g=fixture(()=>Promise.reject(Error('offline')),async()=>{throw Error('offline');});await tick();assert.equal(g.state.reloads,0);assert.match(g.nodes['startup-message'].textContent,/失败/);
});
test('retry gives immediate feedback, deduplicates clicks and restores retry after failure',async()=>{
 let reject,calls=0;
 const f=fixture(()=>new Promise(()=>{}),()=>{calls++;return new Promise((_,r)=>reject=r);});
 [...f.timers.values()][0]();const a=f.nodes['startup-retry'].onclick();
 assert.equal(f.nodes['startup-retry'].disabled,true);assert.match(f.nodes['startup-retry'].textContent,/正在重新加载/);
 f.nodes['startup-retry'].onclick();f.events.online();assert.equal(calls,1);
 reject(Error('offline'));await a;
 assert.equal(f.nodes['startup-retry'].disabled,false);assert.match(f.nodes['startup-message'].textContent,/仍无法连接/);assert.equal(f.state.reloads,0);
});
test('retry aborts on timeout and late ready prevents a pending retry from reloading a draft',async()=>{
 const f=fixture(()=>new Promise(()=>{}),(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 const a=f.nodes['startup-retry'].onclick();[...f.timers.values()][0]();await a;
 assert.match(f.nodes['startup-message'].textContent,/超时/);assert.equal(f.nodes['startup-retry'].disabled,false);
 let finish;const g=fixture(()=>new Promise(()=>{}),()=>new Promise(resolve=>finish=resolve));
 const b=g.nodes['startup-retry'].onclick();g.events['rcm-ready']();finish(new Response('{}'));await b;
 assert.equal(g.state.reloads,0);assert.equal(g.nodes['startup-status'].hidden,true);
});
test('failed browser navigation offers another retry instead of leaving a permanently disabled button',async()=>{
 const f=fixture(()=>new Promise(()=>{}));await f.nodes['startup-retry'].onclick();assert.equal(f.state.reloads,1);
 [...f.timers.values()][0]();assert.match(f.nodes['startup-message'].textContent,/重新加载超时/);assert.equal(f.nodes['startup-retry'].disabled,false);
});
test('initial pageshow does not silently retry a fast failure, but a restored page can recover',async()=>{
 const f=fixture(()=>new Promise(()=>{}));[...f.timers.values()][0]();
 f.events.pageshow({persisted:false});await tick();assert.equal(f.state.reloads,0);
 f.events.pageshow({persisted:true});await tick();assert.equal(f.state.reloads,1);
});
