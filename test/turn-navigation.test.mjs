import test from 'node:test';
import assert from 'node:assert/strict';
import {turnPreview,loadAllEarlier,turnCountLabel,navigationIndex} from '../public/turn-navigation.js';
test('preview uses the first user input and final answer without splitting steer messages or tools',()=>{
 const turn={id:'native-turn',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'原始问题'}]},{type:'commandExecution',aggregatedOutput:'private tool output'},{type:'agentMessage',phase:'commentary',text:'过程'},{type:'userMessage',content:[{type:'text',text:'补充'}]},{type:'agentMessage',phase:'final_answer',text:'| 字段 | 值 |\n|---|---|\n| A | B |'}]};
 const before=JSON.stringify(turn),p=turnPreview(turn);assert.equal(p.id,'native-turn');assert.equal(p.question,'原始问题');assert.match(p.answer,/字段/);assert.equal(JSON.stringify(turn),before);
});
test('goal, attachment-only, continuation and uncertain live turns keep accurate labels',()=>{
 assert.equal(turnPreview({items:[{type:'goalMessage',objective:'目标原文'}]}).question,'目标原文');
 assert.equal(turnPreview({items:[{type:'userMessage',content:[{type:'image',url:'test'}]}]}).question,'图片消息');
 assert.equal(turnPreview({status:'inProgress',items:[]}).question,'继续执行');
 const unknown=turnPreview({status:{type:'inProgress'}},{uncertain:true});assert.equal(unknown.status,'状态待确认');assert.equal(unknown.running,false);
});
test('preview truncates without changing original messages or breaking unicode',()=>{
 const text='😀'.repeat(200);const p=turnPreview({items:[{type:'userMessage',content:[{type:'text',text}]},{type:'agentMessage',text:'x'.repeat(1200)}]});
 assert.equal(Array.from(p.question).length,181);assert.ok(p.question.endsWith('😀…'));assert.equal(p.answer.length,1001);
});

const expansion=(overrides={})=>{
 const state={hasEarlier:true,cursor:'a',loading:false,turns:[]};let current=true;
 return {state,stop:()=>{current=false;},options:{context:()=>state,isCurrent:()=>current,yieldPage:async()=>{},...overrides}};
};
test('full expansion drains pages sequentially, reports progress and skips completed history',async()=>{
 let calls=0,active=0,max=0,progress=0;
 const x=expansion({onProgress:()=>progress++});
 x.options.loadEarlier=async()=>{max=Math.max(max,++active);await Promise.resolve();calls++;x.state.cursor=String(calls);x.state.hasEarlier=calls<4;active--;return true;};
 assert.equal(await loadAllEarlier(x.options),true);assert.equal(calls,4);assert.equal(max,1);assert.equal(progress,4);
 await loadAllEarlier(x.options);assert.equal(calls,4);
});
test('failed expansion keeps the cursor and retries only remaining history',async()=>{
 const x=expansion();let calls=0;
 x.options.loadEarlier=async()=>{calls++;if(calls===1){x.state.cursor='b';return true;}if(calls===2)return false;x.state.hasEarlier=false;return true;};
 assert.equal(await loadAllEarlier(x.options),false);assert.equal(x.state.cursor,'b');assert.equal(calls,2);
 assert.equal(await loadAllEarlier(x.options),true);assert.equal(calls,3);
});
test('cancel or context switch while a page is pending stops the next page and progress',async()=>{
 let finish,calls=0,progress=0;const x=expansion({onProgress:()=>progress++});
 x.options.loadEarlier=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const pending=loadAllEarlier(x.options);x.stop();finish(true);
 assert.equal(await pending,false);assert.equal(calls,1);assert.equal(progress,0);
});
test('non-advancing cursors do not produce duplicate requests',async()=>{
 const x=expansion();let calls=0;x.options.loadEarlier=async()=>{calls++;return true;};
 assert.equal(await loadAllEarlier(x.options),false);assert.equal(calls,1);
});

test('navigation counts explicit inputs, never native execution totals',()=>{
 const turns=[{id:'input',items:[{type:'userMessage'}]},{id:'auto',items:[]}];
 assert.equal(turnCountLabel({totalTurns:231,turns,hasEarlier:true}),'已加载 1 轮');
 assert.equal(turnCountLabel({turns,hasEarlier:false}),'共 1 轮');
 assert.equal(turnCountLabel({totalTurns:0,turns:[],hasEarlier:false}),'共 0 轮');
});
test('continuations have no tick and reading them retains the preceding input anchor',()=>{
 const turns=[{id:'older-auto'}, {id:'question',items:[{type:'userMessage',content:[{type:'text',text:'继续执行'}]}]},
  {id:'auto',items:[{type:'agentMessage',text:'原始回复'}]}, {id:'empty',items:[]},
  {id:'goal',items:[{type:'goalMessage',objective:'明确设置的目标'}]}, {id:'goal-auto'},
  {id:'image',items:[{type:'userMessage',content:[{type:'image',url:'test'}]}]}];
 const before=JSON.stringify(turns),{inputs,owners}=navigationIndex(turns);
 assert.deepEqual(inputs.map(t=>t.id),['question','goal','image']);
 assert.equal(owners.get('older-auto'),undefined);
 assert.equal(owners.get('auto'),'question');assert.equal(owners.get('empty'),'question');
 assert.equal(owners.get('goal-auto'),'goal');assert.equal(owners.get('image'),'image');
 assert.equal(turnPreview(inputs[0]).question,'继续执行');
 assert.equal(JSON.stringify(turns),before);
});

test('navigation waits for an existing history page, then drains all remaining pages',async()=>{
 const x=expansion();let waits=0,calls=0;
 x.state.loading=true;
 x.options.waitForPage=async()=>{waits++;x.state.cursor='after-existing';x.state.loading=false;};
 x.options.loadEarlier=async()=>{assert.equal(x.state.loading,false);calls++;x.state.cursor='page-'+calls;x.state.hasEarlier=calls<3;return true;};
 assert.equal(await loadAllEarlier(x.options),true);assert.equal(waits,1);assert.equal(calls,3);
});
test('context switch during existing page wait prevents a subsequent request',async()=>{
 const x=expansion();x.state.loading=true;let calls=0;
 x.options.waitForPage=async()=>x.stop();x.options.loadEarlier=async()=>{calls++;return true;};
 assert.equal(await loadAllEarlier(x.options),false);assert.equal(calls,0);
});
test('a pending page that exhausts history needs no extra request',async()=>{
 const x=expansion();x.state.loading=true;let calls=0;
 x.options.waitForPage=async()=>{x.state.loading=false;x.state.hasEarlier=false;};
 x.options.loadEarlier=async()=>{calls++;return true;};
 assert.equal(await loadAllEarlier(x.options),true);assert.equal(calls,0);
});

test('partial continuation history does not claim zero conversation turns',()=>{
 const turns=[{id:'continuation',items:[{type:'agentMessage',text:'原始回复'}]}];
 assert.equal(turnCountLabel({turns,hasEarlier:true}),'待加载轮次');
 assert.equal(turnCountLabel({turns,hasEarlier:true,loading:true}),'正在加载轮次');
 assert.equal(turnCountLabel({turns,hasEarlier:true,loadMessage:'加载失败'}),'加载未完成，点击重试');
 assert.equal(turnCountLabel({turns,hasEarlier:false}),'共 0 轮');
 const input={id:'question',items:[{type:'userMessage'}]};
 assert.equal(turnCountLabel({turns:[input,...turns],hasEarlier:true,loading:true}),'已加载 1 轮 · 加载中');
 assert.equal(turnCountLabel({turns:[input,...turns],hasEarlier:true,loadMessage:'已取消'}),'已加载 1 轮 · 点击重试');
 assert.equal(turnCountLabel({turns:[input,...turns],hasEarlier:false,loadMessage:'旧错误'}),'共 1 轮');
});
