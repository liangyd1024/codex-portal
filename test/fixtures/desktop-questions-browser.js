// Extend mobile-browser.js. Desktop questions/recovery never reach a real engine.
(() => {
 const f=window.rcmFixture,id=f.threads[0].id;
 const item={id:'desktop-question',type:'agentMessage',text:'选择验收结果',questions:[{title:'选择验收结果',options:['通过','需调整']}]};
 f.owned.clear();f.handoffs=[{threadId:id,state:'released'}];f.desktopAvailable=true;
 f.turns.set(id,[{id:'desktop-turn',status:'inProgress',items:[item]}]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:id,desktopMode:true}));
 const previous=window.fetch,json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const p=new URL(url,location.href).pathname;if(!p.startsWith('/api/desktop/'))return previous(url,options);
  const body=options.body?JSON.parse(options.body):{};f.calls.push({path:p,method:options.method||'GET',body});
  if(f.offline)throw new TypeError('fixture offline');
  if(f.fail?.path===p){f.fail=null;return json({error:{message:'模拟失败，草稿保留',code:'DESKTOP_NOT_SENT'}},409);}
  if(p.endsWith('/recover'))f.desktopAvailable=true;
  if(p.endsWith('/question-answer')){
   f.turns.get(id)[0].items.push({id:'reply',type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>\n'+JSON.stringify(item.questions.map((q,i)=>({questionItemId:JSON.stringify(['request_user_input_async',item.id,i]),question:q.title,answer:body.answers[JSON.stringify(['request_user_input_async',item.id,i])].answers[0]})))+'\n</send_user_message_question_reply>'}]});
   return json({resolved:true});
  }
  if(p.endsWith('/message'))return json({accepted:true,turnId:'desktop-turn'});
  return json({thread:{...f.threads[0],status:{type:'active'}},turns:f.turns.get(id),controlled:false,controlState:'desktop',desktop:{available:f.desktopAvailable,canSend:f.desktopAvailable,canAnswer:f.desktopAvailable,receipts:{},error:f.desktopAvailable?null:'桌面尚未加载此会话，请恢复桌面连接。'},pendingRequests:[]});
 };
})();
