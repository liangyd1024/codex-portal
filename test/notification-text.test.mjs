import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationExcerpt,notificationTitle,notificationPreview} from '../shared/notification-text.js';
import {notificationPayload,encryptPush,createPushKeys} from '../lib/web-push.mjs';
test('previews use native final answer, question, error and blocked goal without tool output',()=>{
 assert.equal(notificationPreview('turn/completed',{turn:{status:'completed',items:[{type:'commandExecution',aggregatedOutput:'secret'},{type:'agentMessage',phase:'final_answer',text:'完成部署'},{type:'agentMessage',phase:'commentary',text:'进度'}]}}),'完成部署');
 assert.equal(notificationPreview('turn/completed',{turn:{status:'failed',error:{message:'连接已中断'},items:[{type:'agentMessage',text:'旧输出'}]}}),'连接已中断');
 assert.equal(notificationPreview('manager/request',{request:{params:{questions:[{question:'选择哪个环境？'},{question:'什么时候发布？'}]}}}),'选择哪个环境？；什么时候发布？');
 assert.equal(notificationPreview('thread/goal/updated',{goal:{objective:'完成报表导出'}}),'完成报表导出');
 assert.equal(notificationPreview('turn/completed',{turn:{status:'completed',items:[{type:'agentMessage',phase:'commentary',text:'仍在工作'}]}}),'');
});
test('preview strips formatting, limits Unicode length and fits encrypted declarative push',()=>{
 assert.equal(notificationExcerpt('## 完成\n**修改** [页面](https://example.com)\n```\n命令输出\n```'),'完成 修改 页面');
 const title=notificationTitle('本次执行已完成','🧪'.repeat(100),'thread'),body=notificationExcerpt('🧪'.repeat(500));assert.equal(Array.from(body).length,120);
 const payload=notificationPayload({title,body,tag:'a'.repeat(64),data:{host:'remote',threadId:'00000000-0000-4000-8000-000000000001'}},'https://portal.example.com');
 const subscription={keys:{p256dh:createPushKeys().publicKey,auth:Buffer.alloc(16).toString('base64url')}};assert.doesNotThrow(()=>encryptPush(subscription,JSON.stringify(payload)));
});
