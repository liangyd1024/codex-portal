// Load after mobile-browser.js. All requests remain intercepted by that fixture.
(()=>{
 const f=window.rcmFixture;f.threads.forEach((t,i)=>{t.id='turn-nav-'+i;t.name='轮次导航验收 '+(i+1);t.originator='remote_codex_manager';});f.owned=new Set(['turn-nav-0','turn-nav-1']);f.turns.clear();f.history.clear();
 const turn=i=>({id:'navigation-turn-'+i,status:i===20?'inProgress':'completed',startedAt:1700000000+i*60,items:[{id:'question-'+i,type:'userMessage',content:[{type:'text',text:'第 '+i+' 个问题：检查示例服务的发布流程，保留现有数据。'}]},{id:'answer-'+i,type:'agentMessage',phase:'final_answer',text:'第 '+i+' 轮回复：建议先核对流程，再验证结果。\n\n| 问题 | 处理方案 | 验收标准 |\n|---|---|---|\n| 发布失败 | 检查配置 | 健康检查通过 |\n\n'+('这是保留原文的示例回复，用于检查滚动定位和流式更新。\n\n').repeat(8)}]});
 f.turns.set('turn-nav-0',Array.from({length:16},(_,i)=>turn(i+5)));f.turns.set('turn-nav-1',[{...turn(99),status:'completed'}]);f.history.set('turn-nav-0',Array.from({length:5},(_,i)=>turn(4-i)));
 f.addOutput=()=>{f.turns.get('turn-nav-0').at(-1).items.at(-1).text+='\n\n新增流式输出。';f.emit('item/agentMessage/delta',{threadId:'turn-nav-0',turnId:'navigation-turn-20',itemId:'answer-20',delta:'\n\n新增流式输出。'});};
})();
