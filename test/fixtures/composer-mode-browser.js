// Native mode fixture. Requests remain inside mobile-browser's simulated API.
(() => {
 const f=window.rcmFixture;
 f.threads[0].name='计划模式恢复验收';
 f.turns.set('qa-a',[{id:'mode-plan',status:'completed',collaborationMode:{mode:'plan'},items:[{id:'mode-user',type:'userMessage',content:[{type:'text',text:'请先制定计划。'}]}]}]);
 f.turns.set('qa-b',[{id:'mode-default',status:'completed',collaborationMode:{mode:'default'},items:[]}]);
})();
