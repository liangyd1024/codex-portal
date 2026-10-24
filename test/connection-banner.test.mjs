import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/connection-banner.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {connectionBanner}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const context=()=>({transport:true,error:'',connection:'connected',connected:true,desktopMode:false,limited:false,recoveryMessage:()=>''});
test('connection banner retains priority and does not read lower-priority recovery state',()=>{
 const state={...context(),transport:false,error:'连接错误',connection:'connecting',stage:'verify',stageLabel:'核验',loginRecovery:'登录失效',limited:true,recoveryMessage:()=>{throw Error('must not read');}};
 assert.match(connectionBanner(state).text,/网页服务的连接已中断/);
 state.transport=true;assert.deepEqual(connectionBanner(state),{hidden:false,className:'connection-banner error',text:'连接错误'});
 state.error='';assert.equal(connectionBanner(state).text,'正在连接目标机器。核验…');
 state.connection='connected';assert.equal(connectionBanner(state).text,'登录失效');
 state.desktopMode=true;assert.match(connectionBanner(state).text,/部分协议读取/);
 state.limited=false;state.connected=false;assert.deepEqual(connectionBanner(state),{hidden:true});
});
test('capability notices retain unknown names, insertion order and stage fallback',()=>{
 const state={...context(),limited:true,features:{futureAction:{supported:false},message:{supported:false},stop:{supported:true},queue:{}}};
 assert.equal(connectionBanner(state).text,'已连接。当前引擎暂不支持：futureAction、发送消息、排队输入。其他已核验功能仍可使用。详见连接诊断。');
 assert.equal(connectionBanner({...context(),connection:'reconnecting'}).text,'正在连接目标机器。正在核验连接状态…');
 assert.equal(connectionBanner({...context(),connection:'reconnecting',stage:'futureStage'}).text,'正在连接目标机器。futureStage…');
});
test('hidden updates preserve prior text and class; selected recovery becomes visible',()=>{
 const error=connectionBanner({...context(),error:'原错误'});
 assert.deepEqual({...error,...connectionBanner(context())},{hidden:true,className:'connection-banner error',text:'原错误'});
 assert.deepEqual(connectionBanner({...context(),recoveryMessage:()=> '当前会话恢复失败'}),{hidden:false,className:'connection-banner',text:'当前会话恢复失败'});
});
