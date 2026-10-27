import test from 'node:test';
import assert from 'node:assert/strict';
import {createThreadViewReporter} from '../src/web/services/thread-view.ts';

test('opening tasks alongside a conversation retains its native view and avoids another request',async()=>{
 const calls=[],context={state:{transport:true,desktopMode:false,selectedId:'test-thread',detailVersion:1,status:{instanceId:'fixture'}},newChatOpen:false,automations:{opened:false}};
 const reporter=createThreadViewReporter({viewId:'test-view',host:'fixture',context:()=>context,request:async(path,options)=>calls.push({path,...options}),refresh(){}});
 await reporter.report();context.automations.opened=true;await reporter.report();
 assert.equal(calls.length,1);assert.equal(calls[0].body.threadId,'test-thread');
 reporter.reset();await reporter.report();assert.equal(calls[1].body.threadId,'test-thread');
 context.newChatOpen=true;await reporter.report();assert.equal(calls[2].body.threadId,null);
});
