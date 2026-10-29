import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomations} from '../lib/native-automations.mjs';
const id='00000000-0000-0000-0000-000000000001',client='00000000-0000-0000-0000-000000000002',turn='00000000-0000-0000-0000-000000000003';
function fixture(){
 const calls=[],queue=[{id:'q',clientUserMessageId:client,input:[{type:'text',text:'later'}]}];let active=true;
 const m={controlled:new Map(),subscriptions:new Map(),mutations:0,generation:1,saveState(){},requireLogin(){},requireCapability(){},service:{protocolValidation:{features:{queueWrite:{supported:true}}}},passive:async a=>a==='history'?{data:[]}:{thread:{id,cwd:'/project',activity:{state:active?'running':'idle',activeTurnId:turn}}}};
 m.rpc={connected:true,request:async(method,params)=>{calls.push({method,params});if(method==='thread/queue/list')return {data:[...queue]};if(method==='thread/queue/delete'){const at=queue.findIndex(q=>q.id===params.queuedSubmissionId);if(at<0)return {deleted:false};queue.splice(at,1);return {deleted:true};}if(method==='thread/queue/add'){const queuedSubmission={id:'added',...params};queue.push(queuedSubmission);return {queuedSubmission};}return {};}};
 const s=new NativeAutomations(m,{threadId:id});s.call=async(_,params)=>{calls.push({method:params.action,params});return params.action==='send'?{result:{result:{turnId:turn}}}:{};};
 return {s,m,calls,queue,setActive:v=>active=v};
}
test('desktop queue send never loads or claims the native thread and deduplicates retries',async()=>{
 const {s,calls}=fixture();const request={threadId:id,messageId:client,text:'later',followUp:'queue'};
 const result=await s.send(request);assert.equal(result.delivery,'queue');assert.equal(result.queuedSubmission.id,'added');await s.send(request);
 assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,1);assert.equal(calls.some(c=>c.method==='send'||c.method==='thread/resume'),false);
});
test('desktop queue steering takes the native entry before IPC and preserves client identity',async()=>{
 const {s,calls,queue}=fixture();await s.queue('steer',{queuedSubmissionId:'q'});
 const operations=calls.filter(c=>c.method!=='probe'&&c.method!=='thread/queue/list');
 assert.deepEqual(operations.map(c=>c.method),['thread/queue/delete','send']);assert.equal(operations[1].params.messageId,client);assert.equal(operations[1].params.steer,true);assert.equal(queue.length,0);
 await assert.rejects(s.queue('steer',{queuedSubmissionId:'q'}),e=>e.code==='QUEUE_CHANGED');assert.equal(calls.filter(c=>c.method==='send').length,1);
});
test('queue already consumed or current turn ended never dispatches another copy',async()=>{
 for(const idle of [false,true]){const {s,m,calls,setActive}=fixture();if(idle)setActive(false);else{const request=m.rpc.request;m.rpc.request=(method,p)=>method==='thread/queue/delete'?{deleted:false}:request(method,p);}
 await assert.rejects(s.queue('steer',{queuedSubmissionId:'q'}),e=>e.code==='QUEUE_CHANGED');assert.equal(calls.some(c=>c.method==='send'),false);assert.equal(s.unconfirmed(),undefined);}
});
test('uncertain desktop queue steering is durable and blocks resending',async()=>{
 const {s,calls,queue}=fixture(),call=s.call;s.call=async(script,p)=>{if(p.action==='send')throw Object.assign(Error('lost'),{code:'OUTCOME_UNKNOWN'});return call(script,p);};
 await assert.rejects(s.queue('steer',{queuedSubmissionId:'q'}),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(queue.length,0);assert.equal(s.state.submissions[client].status,'unknown');assert.equal(s.state.submissions[client].queuedSubmission.input[0].text,'later');
 await assert.rejects(s.queue('steer',{queuedSubmissionId:'q'}),e=>e.code==='SEND_PENDING');assert.equal(calls.some(c=>c.method==='thread/queue/add'),false);
});
test('definite IPC non-delivery restores only the removed native entry',async()=>{
 const {s,calls,queue}=fixture(),call=s.call;s.call=async(script,p)=>{if(p.action==='send')throw Object.assign(Error('not sent'),{code:'DESKTOP_NOT_SENT'});return call(script,p);};
 await assert.rejects(s.queue('steer',{queuedSubmissionId:'q'}),e=>e.code==='DESKTOP_NOT_SENT');assert.equal(queue.length,1);assert.equal(queue[0].clientUserMessageId,client);assert.equal(s.unconfirmed(),undefined);
});
