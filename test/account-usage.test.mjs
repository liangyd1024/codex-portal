import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccountUsage} from '../lib/account-usage.mjs';
import {usageLabel,installAccountUsage} from '../public/account-usage.js';
const manager=(account,usage)=>({generation:1,requireConnected(){},rpc:{request:async method=>method==='account/read'?{account}:usage}});
test('API key accounts never request rate limits',async()=>{
 const m=manager({type:'apiKey'});assert.deepEqual(await readAccountUsage(m),{visible:false});
});
test('native account usage prefers the codex bucket',async()=>{
 const rateLimits={primary:{usedPercent:25,windowDurationMins:300}};
 assert.deepEqual(await readAccountUsage(manager({type:'chatgpt'},{rateLimits:{},rateLimitsByLimitId:{codex:rateLimits}})),{visible:true,rateLimits});
 assert.equal(usageLabel({rateLimits}).text,'5h 75%');
 assert.equal(usageLabel({rateLimits:{primary:{usedPercent:100},secondary:{usedPercent:0,windowDurationMins:10080}}}).text,'额度 0% · 周 100%');
 assert.equal(usageLabel({rateLimits:{}}).text,'用量 —');
});
test('disconnect invalidates late usage and reconnect can refresh',async()=>{
 let resolve,online=true;const node={hidden:true,textContent:'',setAttribute(){}};
 const refresh=installAccountUsage({node,api:()=>new Promise(r=>resolve=r),connected:()=>online,context:()=>1});
 const pending=refresh();online=false;await refresh();resolve({visible:true,rateLimits:{primary:{usedPercent:1}}});await pending;
 assert.equal(node.hidden,true);assert.equal(node.textContent,'');
});
