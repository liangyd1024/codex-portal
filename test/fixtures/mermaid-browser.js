// Isolated fictional messages, loaded before the application.
(()=>{
 const f=window.rcmFixture;
 f.threads[0].name='图表渲染验收';
 const invalid=new URL(location.href).searchParams.has('diagramInvalid');
 f.turns.set('qa-a',[{id:'diagram-turn',status:'completed',items:[
  {id:'diagram-user',type:'userMessage',content:[{type:'text',text:'绘制验收流程。'}]},
  {id:'diagram-answer',type:'agentMessage',phase:'final_answer',text:(invalid?'```mermaid\nnot-a-diagram!!!\n```': '图表样本：\n\n```mermaid\nflowchart LR\n A[输入] --> B[验证]\n B --> C[完成]\n```')}
 ]}]);
 f.threads[1].name='有效图表恢复验收';
 f.turns.set('qa-b',[{id:'valid-diagram-turn',status:'completed',items:[{id:'valid-diagram-answer',type:'agentMessage',phase:'final_answer',text:'```mermaid\nflowchart TD\n A[恢复] --> B[成功]\n```'}]}]);
 f.streamText=()=>{const delta='\n\n追加正文，保留原图表。';f.turns.get('qa-a')[0].items[1].text+=delta;f.emit('item/agentMessage/delta',{threadId:'qa-a',turnId:'diagram-turn',itemId:'diagram-answer',delta});};
})();
