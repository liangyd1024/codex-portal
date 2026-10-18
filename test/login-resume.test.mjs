import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/login.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(fetch){
  const nodes=Object.fromEntries(['pair-form','pair-code','pair-status','pair-retry','button'].map(id=>[id,{hidden:id==='pair-form',value:'123456',addEventListener(){},setAttribute(){},setCustomValidity(){},reportValidity(){},focus(){}}]));
  nodes['pair-form'].querySelector=()=>nodes.button;
  const events={},state={reloads:0,calls:[]};
  vm.runInNewContext(source,{document:{hidden:false,getElementById:id=>nodes[id],addEventListener:(key,fn)=>events[key]=fn},window:{addEventListener:(key,fn)=>events[key]=fn},location:{reload:()=>state.reloads++},fetch:(...args)=>{state.calls.push(args);return fetch(...args);},AbortController,setTimeout,clearTimeout});
  return {nodes,events,state};
}
const expired=()=>new Response(JSON.stringify({error:{code:'PAIRING_REQUIRED'}}),{status:401});
test('pairing page recognizes existing cookie and enters without submitting a new code',async()=>{
  const f=fixture(async()=>new Response(JSON.stringify({local:false})));await tick();
  assert.equal(f.state.reloads,1);assert.equal(f.nodes['pair-form'].hidden,true);
  assert.equal(f.state.calls[0][0],'/api/access/status');assert.equal(f.state.calls[0][1].credentials,'same-origin');
  assert.ok(f.state.calls.every(([,options])=>options.method!=='POST'));
});
test('expired login shows pairing; a network interruption can recover on reconnect without code submission',async()=>{
  let online=false;const f=fixture(async()=>{if(!online)throw new TypeError('offline');return new Response(JSON.stringify({local:false}));});await tick();
  assert.equal(f.nodes['pair-retry'].hidden,false);assert.equal(f.state.reloads,0);
  online=true;await f.events.online();assert.equal(f.state.reloads,1);
  const g=fixture(async()=>expired());await tick();assert.equal(g.nodes['pair-form'].hidden,false);assert.equal(g.state.reloads,0);
});
test('late login check cannot replace a manual pairing result',async()=>{
  let resolveCheck;let first=true;
  const f=fixture(async(url)=>{if(url==='/api/access/login')return new Response('{}');if(first){first=false;return expired();}return new Promise(resolve=>resolveCheck=resolve);});
  await tick();const checking=f.events.focus();await tick();await f.nodes['pair-form'].onsubmit({preventDefault(){}});
  resolveCheck(expired());await checking;
  assert.equal(f.state.reloads,1);assert.match(f.nodes['pair-status'].textContent,/配对成功/);
});
