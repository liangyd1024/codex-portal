// Inject after mobile-browser.js; all business requests are simulated.
(()=>{
 const f=window.rcmFixture;
 f.threads[0].name='正文文件变更验收';f.threads[1].name='无文件变更的会话';
 const patch=(id,path,diff,status='completed')=>({id,type:'fileChange',status,changes:[{path,kind:{type:'update'},diff}]});
 f.turns.set('qa-a',[
  {id:'previous',status:'completed',items:[{id:'old-user',type:'userMessage',content:[{type:'text',text:'检查上一轮修改。'}]},patch('old-edit','/test/project/previous.js','@@ -1 +1 @@\n-old\n+previous'),{id:'old-answer',type:'agentMessage',phase:'final_answer',text:'上一轮已完成。'}]},
  {id:'current',status:'completed',items:[{id:'new-user',type:'userMessage',content:[{type:'text',text:'把文件变更清单放在回复下方。'}]},patch('first-edit','/test/project/public/example.js','@@ -1 +1 @@\n-before\n+after'),patch('repeat-edit','/test/project/public/example.js','@@ -1 +1 @@\n-after\n+final'),patch('long-edit','/test/project/docs/'+('长路径-'.repeat(12))+'example.md','@@ -0,0 +1 @@\n+'+'长代码'.repeat(100)),{id:'new-answer',type:'agentMessage',phase:'final_answer',text:'已完成修改。文件变更清单显示在本轮回复下方。'}]}
 ]);
 f.turns.set('qa-b',[{id:'no-files',status:'completed',items:[{id:'plain-answer',type:'agentMessage',phase:'final_answer',text:'本轮没有文件变更。'}]}]);
 f.streamText=()=>{const t=f.turns.get('qa-a')[1];t.items.at(-1).text+=' 新增正文。';f.emit('item/agentMessage/delta',{threadId:'qa-a',turnId:t.id,itemId:'new-answer',delta:' 新增正文。'});};
 f.addEdit=status=>{const t=f.turns.get('qa-a')[1],item=patch('live-edit','/test/project/pending.js',status==='completed'?'@@ -1 +1 @@\n-before\n+done':'',status);const index=t.items.findIndex(i=>i.id===item.id);if(index<0)t.items.splice(t.items.length-1,0,item);else t.items[index]=item;f.emit(status==='inProgress'?'item/started':'item/completed',{threadId:'qa-a',turnId:t.id,item});};
})();
