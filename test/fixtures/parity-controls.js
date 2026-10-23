// Optional controls for isolated browser acceptance fixtures, never a production asset.
if(new URL(location.href).searchParams.get('parityControls')==='1'){
  addEventListener('DOMContentLoaded',()=>{
    const f=window.rcmFixture;
    if(!f)throw Error('Parity controls require the isolated fixture.');
    const panel=document.createElement('details');
    panel.setAttribute('aria-label','验收模拟控制');
    panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;color:black;border:1px solid black;padding:4px;max-width:300px;max-height:50vh;overflow:auto;font:14px sans-serif';
    const summary=document.createElement('summary');summary.textContent='验收模拟控制';panel.append(summary);
    const output=document.createElement('pre');output.setAttribute('aria-label','模拟记录');output.style.cssText='white-space:pre-wrap;max-width:280px';
    const button=(name,run)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.style.cssText='display:block;min-height:44px;width:100%;background:white;color:black;border:1px solid black';b.onclick=()=>{run();panel.open=false;};panel.append(b);};
    button('模拟 SSE 断开',()=>f.stream?.onerror?.());
    button('模拟 SSE 恢复',()=>f.stream?.onopen?.());
    button('模拟问题',()=>f.question());
    button('下次创建会话失败',()=>{f.fail={path:'/api/threads',status:503,message:'模拟创建失败，请重试。'};});
    button('下次首条消息失败',()=>{f.fail={path:'/api/threads/qa-new-'+f.threads.length+'/message',status:503,message:'模拟首条消息失败，请重试。'};});
    button('模拟异步问题',async()=>{
      await import('/__fixtures/questions-browser.js');
      f.update();f.emit('turn/started',{threadId:'qa-a',turn:f.turns.get('qa-a')[0]});
    });
    button('下次异步回答失败',()=>{f.fail={path:'/api/threads/qa-a/question-answer',status:503};});
    button('准备排队消息',()=>{
      const turn={id:'qa-running-turn',status:'inProgress',items:[]};
      f.turns.set('qa-a',[...f.turns.get('qa-a').filter(t=>t.id!==turn.id),turn]);
      f.threads.find(t=>t.id==='qa-a').status={type:'active'};
      f.queues.set('qa-a',[
        {id:'qa-queued-guide',input:[{type:'text',text:'排队引导：甲'}]},
        {id:'qa-queued-delete',input:[{type:'text',text:'排队删除：乙'}]}
      ]);
      f.emit('turn/started',{threadId:'qa-a',turn});
      f.emit('thread/queue/changed',{threadId:'qa-a'});
    });
    button('下次排队删除失败',()=>{f.fail={path:'/api/threads/qa-a/queue-delete',status:503,message:'模拟排队删除失败，请重试。'};});
    button('准备较早历史',()=>{
      f.history.set('qa-a',[{id:'qa-earlier-turn',status:'completed',items:[
        {id:'qa-earlier-user',type:'userMessage',content:[{type:'text',text:'较早提问：保留中文与标点。'}]},
        {id:'qa-earlier-agent',type:'agentMessage',text:'较早回复：完整历史，不改原文。'}
      ]}]);
      f.emit('thread/queue/changed',{threadId:'qa-a'});
    });
    button('下次回答失败',()=>{f.fail={path:'/api/requests/qa-question/respond',status:503,message:'模拟回答失败，请重试。'};});
    button('追加流式原文',()=>{
      if(f.streamText){f.streamText();return;}
      const delta='\n\n流式验收追加：甲乙丙，保留标点。';
      const item=f.turns.get('qa-a')[0].items.find(i=>i.id==='qa-agent');item.text+=delta;
      f.emit('item/agentMessage/delta',{threadId:'qa-a',turnId:'qa-turn',itemId:'qa-agent',delta});
    });
    button('读取模拟记录',()=>{output.textContent=JSON.stringify({writes:f.calls.filter(c=>c.method==='POST'),history:f.calls.filter(c=>c.path.endsWith('/history')),errors:f.errors},null,2);queueMicrotask(()=>{panel.open=true;});});
    panel.append(output);document.body.append(panel);
  });
}
