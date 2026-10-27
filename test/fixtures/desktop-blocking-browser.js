// Extend mobile-browser.js. All desktop calls are synthetic and isolated.
(() => {
 const f=window.rcmFixture,id=f.threads[0].id,turnId='desktop-turn';
 const question={id:0,key:'desktop:fixture-question',kind:'desktopQuestion',method:'item/tool/requestUserInput',threadId:id,ownerClientId:'test-owner',params:{threadId:id,turnId,itemId:'blocking-call',questions:[{id:'scope',question:'选择验收范围',options:[{label:'仅测试',description:'只处理专用测试数据'},{label:'补充说明',description:'输入自定义回答'}]}]}};
 f.owned.clear();f.handoffs=[{threadId:id,state:'released'}];f.desktopAvailable=true;f.blockingQuestions=[question];f.blockingDelay=false;
 f.turns.set(id,[{id:turnId,status:'inProgress',items:[{id:'steer',type:'steeringUserMessage',status:'accepted',input:[{type:'text',text:'请保留这条中文补充指令。'}],restoreMessage:{createdAt:1700000000000}}]}]);
 sessionStorage.setItem('rcm.view.qa-local',JSON.stringify({selectedId:id,desktopMode:true}));
 const previous=window.fetch,json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const p=new URL(url,location.href).pathname;if(!p.startsWith('/api/desktop/'))return previous(url,options);
  const body=options.body?JSON.parse(options.body):{};f.calls.push({path:p,method:options.method||'GET',body});
  if(f.offline)throw new TypeError('fixture offline');
  if(f.fail?.path===p){f.fail=null;return json({error:{message:'模拟失败，草稿保留',code:'DESKTOP_NOT_SENT'}},409);}
  if(p.endsWith('/question-answer')){
   if(f.blockingDelay)await new Promise(resolve=>f.releaseBlocking=resolve);
   f.blockingQuestions=[];return json({resolved:true});
  }
  return json({thread:{...f.threads[0],status:{type:'active'}},turns:f.turns.get(id),controlled:false,controlState:'desktop',desktop:{available:f.desktopAvailable,canSend:f.desktopAvailable,canAnswer:f.desktopAvailable,canStop:f.desktopAvailable,activeTurnId:turnId,receipts:{}},pendingRequests:f.blockingQuestions});
 };
})();
