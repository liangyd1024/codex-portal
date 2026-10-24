import test from 'node:test';
import assert from 'node:assert/strict';
import {installDeferredTool} from '../public/deferred-tool.js';
const details=()=>({open:false,isConnected:true,setAttribute(){},removeAttribute(){}});
test('closed tools do not read or format; concurrent opens share one request',async()=>{
 const d=details();let calls=0,formats=0,finish;
 const reveal=installDeferredTool({details:d,body:{replaceChildren(){}},load:()=>{calls++;return new Promise(r=>finish=r);},render:()=>formats++});
 await reveal();assert.equal(calls,0);d.open=true;const task=reveal();await reveal();assert.equal(calls,1);
 finish({result:'原始内容'});await task;await reveal();assert.equal(formats,1);assert.equal(calls,1);
});
test('late reads from a replaced selection never render into a new view',async()=>{
 const d=details();d.open=true;let current=true,finish,formats=0;
 const reveal=installDeferredTool({details:d,body:{replaceChildren(){}},isCurrent:()=>current,load:()=>new Promise(r=>finish=r),render:()=>formats++});
 const task=reveal();current=false;finish({});await task;assert.equal(formats,0);
});
test('tool failure leaves a retry and subsequent success preserves the result',async t=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({})};t.after(()=>{if(old)globalThis.document=old;else delete globalThis.document;});
 const d=details();d.open=true;let button,calls=0,received;
 const reveal=installDeferredTool({details:d,body:{replaceChildren:(b)=>{button=b;}},load:async()=>{if(++calls===1)throw Error('offline');return {result:'原文'};},render:item=>received=item.result});
 await reveal();assert.match(button.textContent,/重试/);await button.onclick();assert.equal(calls,2);assert.equal(received,'原文');
});
