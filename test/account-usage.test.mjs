import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccountUsage} from '../lib/account-usage.mjs';
import {usageLabel,identityLabel,installAccountUsage} from '../public/account-usage.js';
const manager=(account,usage)=>({generation:1,requireConnected(){},rpc:{request:async method=>method==='account/read'?{account}:usage}});
const element=()=>({hidden:true,textContent:'',title:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;}});
test('API key accounts never request rate limits',async()=>{
 const calls=[];
 const m=manager();m.rpc.request=async method=>{calls.push(method);return {account:{type:'apiKey',apiKey:'private-test-key',keySuffix:'fake',email:'irrelevant@example.test'}};};
 assert.deepEqual(await readAccountUsage(m),{visible:false,account:{type:'apiKey'}});
 assert.deepEqual(calls,['account/read']);
 assert.equal(identityLabel({type:'apiKey'}).text,'API Key');
});
test('native account usage prefers the codex bucket',async()=>{
 const rateLimits={primary:{usedPercent:25,windowDurationMins:300}};
 assert.deepEqual(await readAccountUsage(manager({type:'chatgpt',email:'member@example.test',token:'private-token'},{rateLimits:{},rateLimitsByLimitId:{codex:rateLimits}})),{visible:true,account:{type:'chatgpt',email:'member@example.test'},rateLimits});
 assert.equal(usageLabel({rateLimits}).text,'5h 75%');
 assert.equal(usageLabel({rateLimits:{primary:{usedPercent:100},secondary:{usedPercent:0,windowDurationMins:10080}}}).text,'额度 0% · 周 100%');
 assert.equal(usageLabel({rateLimits:{}}).text,'用量 —');
});
test('disconnect invalidates late usage and reconnect can refresh',async()=>{
 let resolve,online=true;const node=element(),identityNode=element();
 const refresh=installAccountUsage({node,identityNode,api:()=>new Promise(r=>resolve=r),connected:()=>online,context:()=>1});
 const pending=refresh();assert.equal(identityNode.textContent,'正在读取账号…');
 online=false;await refresh();resolve({visible:true,account:{type:'chatgpt',email:'old@example.test'},rateLimits:{primary:{usedPercent:1}}});await pending;
 assert.equal(node.hidden,true);assert.equal(node.textContent,'');
 assert.equal(identityNode.hidden,true);assert.equal(identityNode.title,'');
 online=true;const next=refresh();resolve({visible:false,account:{type:'apiKey'}});await next;
 assert.equal(identityNode.textContent,'API Key');assert.equal(node.hidden,true);
});
test('account identity survives a usage failure but not a changed connection',async()=>{
 const m=manager();m.rpc.request=async method=>{if(method==='account/read')return {account:{type:'chatgpt',email:'member@example.test'}};throw Error('usage unavailable');};
 assert.deepEqual(await readAccountUsage(m),{visible:true,account:{type:'chatgpt',email:'member@example.test'},unavailable:true});
 m.rpc.request=async method=>{if(method==='account/read')return {account:{type:'chatgpt',email:'old@example.test'}};m.generation++;return {};};
 await assert.rejects(readAccountUsage(m),/连接已变化/);
});
test('absent and unknown native identities do not invent account details',async()=>{
 for(const account of [null,{type:'unknown'}])assert.deepEqual(await readAccountUsage(manager(account)),{visible:false,account:null});
 assert.equal(identityLabel({type:'chatgpt',email:null}).text,'ChatGPT 账号');
 assert.equal(identityLabel(null).text,'');
});
test('a new connection wins over delayed identity responses and failures',async()=>{
 for(const fail of [false,true]){
  let key='first',resolve,reject;const node=element(),identityNode=element();
  const refresh=installAccountUsage({node,identityNode,connected:()=>true,context:()=>key,api:()=>key==='first'?new Promise((r,j)=>{resolve=r;reject=j;}):Promise.resolve({visible:false,account:{type:'apiKey'}})});
  const old=refresh();key='second';await refresh();
  if(fail)reject(Error('old request failed'));else resolve({visible:true,account:{type:'chatgpt',email:'old@example.test'}});
  await old;assert.equal(identityNode.textContent,'API Key');assert.equal(node.hidden,true);
 }
});
test('identity refresh handles failure, recovery, auth mode change and logout',async()=>{
 const node=element(),identityNode=element();let result;
 const refresh=installAccountUsage({node,identityNode,connected:()=>true,context:()=>1,api:async()=>{if(result instanceof Error)throw result;return result;}});
 result={visible:true,account:{type:'chatgpt',email:'member@example.test'},rateLimits:{primary:{usedPercent:11,windowDurationMins:10080}}};await refresh();
 assert.equal(identityNode.textContent,'member@example.test');assert.equal(node.textContent,'周 89%');
 result=Error('read failed');await refresh(true);assert.equal(identityNode.textContent,'账号信息暂不可用');assert.equal(node.hidden,true);assert.ok(!identityNode.title.includes('member'));
 result={visible:false,account:{type:'apiKey'}};await refresh(true);assert.equal(identityNode.textContent,'API Key');assert.equal(node.textContent,'');
 result={visible:false,account:null};await refresh(true);assert.equal(identityNode.hidden,true);assert.equal(identityNode.textContent,'');assert.equal(identityNode.attributes['aria-label'],'');
});
test('account notification refresh retires a pending reply on the same connection',async()=>{
 for(const account of [{type:'apiKey'},null,{type:'chatgpt',email:'new@example.test'}]){
  let resolve,calls=0;const node=element(),identityNode=element();
  const refresh=installAccountUsage({node,identityNode,connected:()=>true,context:()=>1,api:()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve({visible:false,account})});
  const old=refresh();await refresh(true);
  resolve({visible:true,account:{type:'chatgpt',email:'old@example.test'},rateLimits:{primary:{usedPercent:15}}});await old;
  assert.equal(identityNode.textContent,identityLabel(account).text);assert.equal(node.hidden,true);
 }
});
test('quota must not be attached to identity read before an account switch',async()=>{
 let reads=0;const m=manager();m.rpc.request=async method=>method==='account/read'?{account:++reads===1?{type:'chatgpt',email:'old@example.test'}:{type:'apiKey'}}:{rateLimits:{}};
 await assert.rejects(readAccountUsage(m),e=>e.code==='ACCOUNT_CHANGED');
});
test('known token invalidation hides obsolete identity and quota and gives recovery guidance',async()=>{
 const m=manager();m.rpc.request=async method=>{if(method==='account/read')return {account:{type:'chatgpt',email:'old@example.test'}};throw Error('Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.');};
 const result=await readAccountUsage(m);assert.equal(result.account,null);assert.equal(result.visible,false);assert.match(result.recovery,/API Key/);
 const node=element(),identityNode=element();const refresh=installAccountUsage({node,identityNode,connected:()=>true,context:()=>1,api:async()=>result});
 await refresh();assert.equal(node.hidden,true);assert.equal(identityNode.textContent,'引擎登录已失效');
});
test('revoked identity reads use the same recovery path as revoked quota reads',async()=>{
 const m=manager();m.rpc.request=async()=>{throw Error('401: token_revoked');};
 const result=await readAccountUsage(m);assert.equal(result.account,null);assert.equal(result.visible,false);assert.match(result.recovery,/重新加载登录/);
});
test('signed out native provider is visible and cannot be mistaken for API key mode',async()=>{
 const m=manager();m.rpc.request=async()=>({account:null,requiresOpenaiAuth:true});
 const result=await readAccountUsage(m);assert.equal(result.signedOut,true);assert.equal(result.visible,false);
 const node=element(),identityNode=element();await installAccountUsage({node,identityNode,connected:()=>true,context:()=>1,api:async()=>result})();
 assert.equal(identityNode.textContent,'未登录');
});
