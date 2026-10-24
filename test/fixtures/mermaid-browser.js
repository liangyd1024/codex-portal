// Isolated fictional messages, loaded before the application.
(()=>{
 const f=window.rcmFixture;
 f.threads[0].name='图表渲染验收';
 f.turns.set('qa-a',[{id:'diagram-turn',status:'completed',items:[
  {id:'diagram-user',type:'userMessage',content:[{type:'text',text:'绘制验收流程。'}]},
  {id:'diagram-answer',type:'agentMessage',phase:'final_answer',text:'图表样本：\n\n```mermaid\nflowchart LR\n A[输入] --> B[验证]\n B --> C[完成]\n```'}
 ]}]);
})();
