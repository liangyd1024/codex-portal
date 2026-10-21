// Extend mobile-browser.js + questions-browser.js. All API writes remain isolated.
(() => {
 const f=window.rcmFixture,q=f.turns.get('qa-a')[0].items[0];
 f.threads[0].name='目标模式 · 方案确认';f.threads[0].originator='remote_codex_manager';
 f.threads[1].name='另一会话 · 正在整理';f.threads[1].status={type:'active'};f.owned.add('qa-b');
 q.id='attention-'+Date.now();q.text='已完成现有实现的核对。下一步需要你确认修改范围。';
 q.questions.splice(1);q.questions[0]={title:'这次修改覆盖哪个范围？',options:['仅修复当前问题','同时补充回归测试']};
 f.notifications=[];
 window.Notification=class {static permission='granted';constructor(title,options){f.notifications.push({title,options});queueMicrotask(()=>this.onshow?.());}close(){this.onclose?.();}};
 localStorage.setItem('rcm.taskNotifications.qa-local','true');
})();
