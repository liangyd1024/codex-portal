// Extend the fully isolated mobile fixture. No API mutation reaches a real engine.
(() => {
 const f=window.rcmFixture;
 const question={id:'async-item',type:'agentMessage',text:'请确认测试方式。',questions:[{title:'选择验收方式',options:['桌面验证','窄屏验证']},{title:'还有什么需要验证？'}]};
 f.turns.set('qa-a',[{id:'async-turn',status:'inProgress',items:[question]}]);f.threads[0].status={type:'active'};
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:'qa-a'}));
 const previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const u=new URL(url,location.href);
  if(u.pathname.endsWith('/question-answer')){
   const body=JSON.parse(options.body);f.calls.push({path:u.pathname,method:options.method,body});
   if(f.delay?.path===u.pathname){const d=f.delay;f.delay=null;await new Promise(resolve=>{d.resolve=resolve;f.pending=d;});}
   if(f.fail?.path===u.pathname){f.fail=null;return new Response(JSON.stringify({error:{message:'模拟回答失败，请重试'}}),{status:503});}
   const replies=question.questions.map((q,i)=>({questionItemId:JSON.stringify(['request_user_input_async',question.id,i]),question:q.title,answer:body.answers[JSON.stringify(['request_user_input_async',question.id,i])].answers[0]}));
   f.turns.get('qa-a')[0].items.push({id:'reply',type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>\n'+JSON.stringify(replies)+'\n</send_user_message_question_reply>'}]});
   return new Response(JSON.stringify({resolved:true}));
  }
  return previous(url,options);
 };
})();
