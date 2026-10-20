import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// Substitute only the module transport so startup hangs/errors are deterministic.
const source=(await readFile(new URL('../public/bootstrap.js',import.meta.url),'utf8')).replace("import('./app.js')",'loadApp()');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(loadApp,fetch=async()=>new Response('{}')){
 const nodes=Object.fromEntries(['startup-status','startup-message','startup-retry'].map(id=>[id,{hidden:false}]));
 const events={},timers=new Map(),state={reloads:0};let seq=0;
 const document={hidden:false,getElementById:id=>nodes[id],addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(source,{document,window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true},location:{reload:()=>state.reloads++},setTimeout:(fn)=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),loadApp,fetch,AbortController});
 return {nodes,events,timers,state,document};
}
test('stalled startup offers retry and resumes when network returns',()=>{
 const f=fixture(()=>new Promise(()=>{}));[...f.timers.values()][0]();
 assert.match(f.nodes['startup-message'].textContent,/超时/);f.events.online();assert.equal(f.state.reloads,1);
});
test('late successful initialization removes error and never reloads an interactive draft',()=>{
 const f=fixture(()=>new Promise(()=>{}));[...f.timers.values()][0]();f.events['rcm-ready']();
 assert.equal(f.nodes['startup-status'].hidden,true);f.events.online();f.events.pageshow();assert.equal(f.state.reloads,0);assert.equal(f.timers.size,0);
});
test('failed module loading checks expired pairing and redirects only for a confirmed auth failure',async()=>{
 const f=fixture(()=>Promise.reject(Error('module unavailable')),async()=>new Response(JSON.stringify({error:{code:'PAIRING_REQUIRED'}}),{status:401}));await tick();assert.equal(f.state.reloads,1);
 const g=fixture(()=>Promise.reject(Error('offline')),async()=>{throw Error('offline');});await tick();assert.equal(g.state.reloads,0);assert.match(g.nodes['startup-message'].textContent,/失败/);
});
