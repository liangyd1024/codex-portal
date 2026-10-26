// Browser-only fixture, injected before app.js by the ego-browser acceptance script.
// Every /api fetch and EventSource is intercepted; no mock mutation reaches a real engine.
(() => {
  const nativeFetch=window.fetch.bind(window), now=Date.now()/1000;
  const host={id:'qa-local',alias:'验收机器',machineId:'qa-machine',home:'/test',user:'tester',kind:'local'};
  const models=[{id:'qa-model',model:'qa-model',displayName:'验收模型',isDefault:true,supportedReasoningEfforts:['low','medium','high'],defaultReasoningEffort:'medium'},{id:'qa-other',model:'qa-other',displayName:'另一模型',supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'low'}];
  const thread=(id,name,projectId='qa-project')=>({id,name,projectId,cwd:'/test/project',model:'qa-model',reasoningEffort:'medium',status:{type:'idle'},revision:'r1',readRevision:'r1',updatedAt:now,sectionId:null,isPinned:false,isUnread:false,archived:false});
  const f=window.rcmFixture={calls:[],fail:null,delay:null,offline:false,connected:true,local:true,origins:[],requests:[],owned:new Set(['qa-a']),handoffs:[],threads:[thread('qa-a','手机验收：长标题与完整操作测试'),thread('qa-b','手机验收：另一会话')],sections:[],turns:new Map(),queues:new Map(),history:new Map(),sidebarLimit:Infinity,errors:[]};
  addEventListener('error',e=>f.errors.push(e.message));addEventListener('unhandledrejection',e=>f.errors.push(String(e.reason)));
  f.turns.set('qa-a',[{id:'qa-turn',status:'completed',items:[{id:'qa-user',type:'userMessage',content:[{type:'text',text:'验收长消息、表格和代码。'}]},{id:'qa-agent',type:'agentMessage',text:'## 手机验收\n\n这是一段用于验收的回复。\n\n| 字段 | 内容 |\n| --- | --- |\n| 长字段 | '+ 'abcdefghij'.repeat(15)+' |\n\n```text\n'+ '长代码'.repeat(80)+'\n```'},{id:'qa-command',type:'commandExecution',command:'test-only command',status:'completed',exitCode:0,aggregatedOutput:'验收输出\n'.repeat(18000)},{id:'qa-image',type:'imageGeneration',status:'completed',imageRef:{threadId:'qa-a',itemId:'qa-image'}}]}]);
  const status=()=>({instanceId:'qa-instance',revision:f.calls.length,connection:{state:f.connected?'connected':'disconnected'},host,service:{running:true,version:'fixture',protocolValidation:{features:Object.fromEntries(['create','message','steer','stop','release','takeover','handoff','queueWrite','queueEdit'].map(k=>[k,{supported:true}]))}},controlledThreads:[...f.owned],subscribedThreads:[...f.owned],controlledSessions:f.threads.filter(t=>f.owned.has(t.id)),pendingRequests:f.requests,handoffs:f.handoffs});
  const detail=id=>({thread:f.threads.find(t=>t.id===id),controlled:f.owned.has(id),controlState:f.owned.has(id)?'controlled':'viewing',turns:f.turns.get(id)||[],queue:{data:f.queues.get(id)||[]},nextCursor:f.history.has(id)?'earlier':null,pendingRequests:f.requests.filter(r=>r.threadId===id),handoff:f.handoffs.find(h=>h.threadId===id)});
  const caps=()=>Object.fromEntries(['rename','pin','read','archive','restore','moveProject','moveSection','createSection','renameSection','deleteSection','reorderThread','preferences','reorderSection','reorderProject','moveProjectSection'].map(k=>[k,{supported:!['preferences','reorderSection','reorderProject','moveProjectSection'].includes(k),reason:'此操作需在桌面版修改，同步后会更新。'}]));
  const sidebar=u=>{const all=f.threads.filter(t=>t.archived===(u.searchParams.get('archived')==='true')&&(!u.searchParams.get('search')||t.name.includes(u.searchParams.get('search'))));const start=Number(u.searchParams.get('cursor'))||0,data=all.slice(start,start+f.sidebarLimit);return {accountScope:'qa-account',data,projects:[{id:'qa-project',name:'验收项目',roots:['/test/project'],threadIds:all.filter(t=>t.projectId==='qa-project').map(t=>t.id)}],sections:f.sections,rootProjectIds:['qa-project'],rootThreadIds:data.filter(t=>!t.projectId).map(t=>t.id),pinnedProjectIds:[],pinnedThreadIds:data.filter(t=>t.isPinned).map(t=>t.id),sectionOrder:[],preferences:{chats:'manual',pinned:'manual'},capabilities:caps(),archived:u.searchParams.get('archived')==='true',nextCursor:start+data.length<all.length?String(start+data.length):null};};
  f.emit=(method,params)=>f.stream?.onmessage?.({data:JSON.stringify({method,params})});
  f.update=()=>f.emit('manager/status',status());
  f.approval=()=>{f.requests=[{id:'qa-approval',key:'qa-approval',threadId:'qa-a',method:'item/commandExecution/requestApproval',params:{threadId:'qa-a',reason:'模拟审批，不会执行命令。',command:'echo fixture',availableDecisions:['accept','decline','cancel']}}];f.update();};
  f.question=()=>{f.requests=[{id:'qa-question',key:'qa-question',threadId:'qa-a',method:'item/tool/requestUserInput',params:{threadId:'qa-a',questions:[{id:'choice',question:'请选择验收方式',options:[{label:'选项一',description:'触控整行选择'},{label:'选项二'}]}]}}];f.update();};
  class Stream {constructor(){f.stream=this;setTimeout(()=>this.onopen?.(),0);}addEventListener(){}close(){}}
  f.NativeEventSource=window.EventSource;
  window.EventSource=Stream;
  class Recognition {constructor(){f.recognition=this;}start(){this.onstart?.();}stop(){this.onend?.();}abort(){} }
  window.SpeechRecognition=Recognition;
  f.dictate=text=>f.recognition?.onresult?.({results:[Object.assign([{transcript:text}],{isFinal:true})]});
  const json=(data,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json'}});
  window.fetch=async(url,options={})=>{
    const u=new URL(typeof url==='string'?url:url.url,location.href),p=u.pathname,method=options.method||'GET';
    if(!p.startsWith('/api/'))return nativeFetch(url,options);
    const body=options.body?JSON.parse(options.body):{};f.calls.push({path:p,query:u.search,method,body});
    if(f.offline)throw new TypeError('fixture offline');
    if(f.delay?.path===p){const d=f.delay;f.delay=null;await new Promise((resolve,reject)=>{d.resolve=resolve;f.pending=d;if(!d.ignoreAbort)options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});}
    if(f.fail?.path===p){const error=f.fail;f.fail=null;return json({error:{message:error.message||'模拟请求失败，请重试。',code:error.code||'FIXTURE_ERROR'}},error.status||503);}
    if(p==='/api/connections')return json({machineId:'qa-machine',defaultConnection:'qa-local',data:[{id:'qa-local',host},{id:'qa-remote',host:{...host,id:'qa-remote',alias:'验收远程机器'}}]});
    if(p==='/api/composer')return json({modes:{data:[{mode:'default'},{mode:'plan'}]},skills:{data:[{skills:[{name:'测试技能',path:'/test/SKILL.md',enabled:true}]}]},plugins:{marketplaces:[{plugins:[{id:'test-plugin',name:'测试插件',enabled:true,installed:true}]}]}});
    if(p==='/api/csrf')return json({token:'fixture-token'});
    if(p==='/api/status')return json(status());
    if(p==='/api/account/usage')return json(f.accountUsage??{visible:false,account:null});
    if(p==='/api/system/update'){f.systemUpdate??={available:true,version:'fixture',job:null};if(method==='POST')f.systemUpdate.job={id:'fixture-update',phase:'queued',message:'已接收，正在准备更新…'};return json(f.systemUpdate);}
    if(p==='/api/models')return json({data:models});
    if(p==='/api/projects')return json({data:[{id:'qa-project',name:'验收项目',roots:['/test/project']}]});
    if(p==='/api/project-folders'){
      const path=method==='POST'?body.parent+'/'+body.name:u.searchParams.get('path')||'/test';
      return json({path,parent:path==='/test'?null:'/test',hostName:'验收机器',entries:path==='/test'?[{name:'project',path:'/test/project'},{name:'.hidden',path:'/test/.hidden'}]:[]});
    }
    if(p==='/api/projects/open')return json({project:{id:'qa-project',name:'验收项目',roots:[body.path]}});
    if(p==='/api/automations')return json({threadId:'qa-b',observedAt:Date.now(),items:[{id:'qa-task',name:'手机验收定时任务',status:'ACTIVE',rrule:'FREQ=HOURLY;INTERVAL=1',prompt:'只用于界面验收，不会实际执行。',target_thread_id:'qa-b'},{id:'qa-paused',name:'已暂停的验收任务',status:'PAUSED',rrule:'FREQ=DAILY;BYHOUR=9',prompt:'暂停状态验收。'}],runs:[{automation_id:'qa-task',thread_id:'qa-b',created_at:Date.now(),status:'ACCEPTED'}]});
    if(p==='/api/automations/candidates')return json({data:f.threads});
    if(p==='/api/automations/binding')return json({threadId:body.threadId});
    const desktopMatch=p.match(/^\/api\/desktop\/threads\/([^/]+)$/);
    if(desktopMatch&&method==='GET'){
      const id=desktopMatch[1],t=f.threads.find(t=>t.id===id);
      if(!t)return json({error:{message:'找不到模拟会话'}},404);
      return json({...detail(id),controlled:false,controlState:'desktop',historySource:'snapshot',
        desktop:{available:true,canSend:!f.owned.has(id)&&t.status.type==='idle',threadReferencesSupported:true,error:null,unconfirmed:null,settings:null,receipts:{}}});
    }
    if(/^\/api\/desktop\/threads\/[^/]+\/message$/.test(p)&&method==='POST')return json({accepted:true,turnId:'qa-desktop-turn',messageId:body.messageId});
    if(p==='/api/sidebar')return json(sidebar(u));
    if(p==='/api/sidebar/activity')return json({accountScope:'qa-account',data:JSON.parse(u.searchParams.get('ids')).map(id=>({id}))});
    if(p==='/api/thread-view'&&method==='POST')return json({ok:true});
    if(p==='/api/connect'||p==='/api/disconnect'||p==='/api/service/release'){f.connected=p==='/api/connect';f.update();return json(status());}
    if(p==='/api/threads'&&method==='POST'){const t=thread('qa-new-'+f.threads.length,'新会话');f.threads.push(t);f.owned.add(t.id);return json(detail(t.id));}
    if(p==='/api/sidebar/actions'){
      const t=f.threads.find(t=>t.id===body.id),s=f.sections.find(s=>s.id===body.id);
      if(t){if(body.action==='rename')t.name=body.name;if(body.action==='pin')t.isPinned=body.pinned;if(body.action==='read')t.isUnread=!body.read;if(body.action==='archive')t.archived=true;if(body.action==='restore')t.archived=false;if(body.action==='moveProject')t.projectId=body.projectId;if(body.action==='moveSection')t.sectionId=body.sectionId;}
      if(t&&body.action==='reorderThread'){f.threads=f.threads.filter(x=>x!==t);const i=f.threads.findIndex(x=>x.id===body.beforeThreadId);f.threads.splice(i<0?f.threads.length:i,0,t);f.threads.forEach((x,i)=>x.sectionPosition=i);}
      if(body.action==='createSection')f.sections.push({id:'qa-section',desktopId:'qa-section',name:body.name,projectIds:[],threadIds:[]});
      if(s&&body.action==='renameSection')s.name=body.name;
      if(s&&body.action==='deleteSection')f.sections=f.sections.filter(x=>x!==s);
      for(const section of f.sections)section.threadIds=f.threads.filter(t=>t.sectionId===section.id).map(t=>t.id);
      return json({ok:true});
    }
    if(p.startsWith('/api/requests/')){f.requests=[];return json({ok:true});}
    const match=p.match(/^\/api\/threads\/([^/]+)(?:\/(.+))?$/);
    if(match){const id=match[1],action=match[2],t=f.threads.find(t=>t.id===id);
      if(!t)return json({error:{message:'找不到模拟会话'}},404);
      if(!action)return json(detail(id));
      if(action==='side-chat'){
        const child=thread(f.sideExpiry?'qa-side-'+(++f.sideSerial):'qa-side','验收侧边聊天');child.ephemeral=true;
        if(!f.threads.some(t=>t.id===child.id))f.threads.push(child);
        return json({thread:child});
      }
      if(action==='side-chat-view')return json(detail(id));
      if(action==='goal'){f.goal=body;return json({goal:body});}
      if(action==='takeover'){f.owned.add(id);f.handoffs=f.handoffs.filter(h=>h.threadId!==id);return json(detail(id));}
      if(action==='handoff'){f.owned.delete(id);const h={threadId:id,state:'released'};f.handoffs.push(h);return json(h);}
      if(action==='queue-add'){const queuedSubmission={id:'q-'+f.calls.length,clientUserMessageId:'c-'+f.calls.length,input:[{type:'text',text:body.text}]};f.queues.set(id,[...(f.queues.get(id)||[]),queuedSubmission]);return json({queuedSubmission});}
      if(action==='queue-update'){
        const item=(f.queues.get(id)||[]).find(q=>q.id===body.queuedSubmissionId);
        if(!item)return json({error:{message:'此消息已离开队列，请刷新会话。',code:'QUEUE_CHANGED'}},409);
        const before=item.input.filter(p=>p.type==='text').map(p=>p.text).join('\n');
        if(before!==body.text&&before!==body.expectedText)return json({error:{message:'排队消息已变化，请重新打开后编辑。草稿已保留。',code:'QUEUE_CHANGED'}},409);
        if(before!==body.text)item.input=[...(body.text.trim()?[{type:'text',text:body.text}]:[]),...item.input.filter(p=>p.type!=='text')];
        return json({queuedSubmission:item});
      }
      if(action==='queue-delete'||action==='queue-steer'){f.queues.set(id,(f.queues.get(id)||[]).filter(q=>q.id!==body.queuedSubmissionId));return json({deleted:true});}
      if(action==='message'||action==='steer'){t.status={type:'active'};const turn={id:'sent-'+f.calls.length,status:'inProgress',items:[{id:'user-'+f.calls.length,type:'userMessage',content:[...(body.text?[{type:'text',text:body.text}]:[]),...(body.images||[]).map(i=>({type:'image',url:i.url}))]}]};f.turns.set(id,[...(f.turns.get(id)||[]),turn]);return json({turn});}
      if(action==='interrupt'){t.status={type:'idle'};for(const turn of f.turns.get(id)||[])turn.status='interrupted';return json({ok:true});}
      if(action==='history'){const all=f.history.get(id)||[],size=f.historyPageSize||all.length,cursor=u.searchParams.get('cursor'),remaining=cursor?.startsWith('earlier-')?Number(cursor.slice(8)):all.length,start=Math.max(0,all.length-remaining),data=all.slice(start,start+size),left=Math.max(0,all.length-start-data.length);return json({data,nextCursor:left?'earlier-'+left:null});}
    }
    if(p==='/api/access/status')return json({local:f.local,sessionExpires:null,origins:f.origins,canSetup:f.local});
    if(p==='/api/access/setup'){f.origins.push(body.mode==='tailscale'?'https://qa.ts.net':'https://192.0.2.1:4319');return json({ok:true});}
    if(p==='/api/access/code')return json({code:'123456',expires:body.ttlSeconds===null?null:Date.now()+(body.ttlSeconds??600)*1000,sessionTtlSeconds:body.sessionTtlSeconds===null?null:body.sessionTtlSeconds??604800});
    if(['/api/access/revoke','/api/access/logout','/api/access/login','/api/notices/ack'].includes(p))return json({ok:true});
    return json({error:{message:'未实现的模拟接口：'+p}},404);
  };
})();
