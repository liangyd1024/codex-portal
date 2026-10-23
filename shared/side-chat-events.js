// A disposable view cache of original native events, never an execution state.
export function applySideEvent(turns,method,p){
 const id=p.turnId||p.turn?.id;if(!id)return;
 let turn=turns.find(t=>t.id===id);if(!turn){turn={id,items:[]};turns.push(turn);}
 if(p.turn){
  // Turn payloads can contain only a subset of items. A late turn/start reply
  // must not erase user messages or roll back items already streamed by SSE.
  const items=[...turn.items],indices=new Map(items.map((item,index)=>[item.id,index]));
  for(const item of p.turn.items||[]){const index=indices.get(item.id);if(index===undefined){indices.set(item.id,items.length);items.push({...item});}else if(method!=='turn/started')items[index]={...item};}
  const status=turn.status,terminal=['completed','failed','interrupted'].includes(status?.type||status);
  Object.assign(turn,p.turn,{items});
  if(method==='turn/started'&&terminal)turn.status=status;
 }
 if(p.item){const index=turn.items.findIndex(i=>i.id===p.item.id);if(index<0)turn.items.push({...p.item});else turn.items[index]={...p.item};}
 if(method==='item/agentMessage/delta'||method==='item/plan/delta'){
  let item=turn.items.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:method.includes('/plan/')?'plan':'agentMessage',text:''};turn.items.push(item);}item.text=(item.text||'')+(p.delta||'');
 }
 if(method==='item/commandExecution/outputDelta'){
  let item=turn.items.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:'commandExecution',status:'inProgress',aggregatedOutput:''};turn.items.push(item);}item.aggregatedOutput=(item.aggregatedOutput||'')+(p.delta||'');
 }
 if(method==='item/reasoning/summaryTextDelta'||method==='item/reasoning/textDelta'){
  let item=turn.items.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:'reasoning',summary:[],content:[]};turn.items.push(item);}const field=method.includes('summary')?'summary':'content',index=p.summaryIndex??p.contentIndex??0;item[field]??=[];item[field][index]=(item[field][index]||'')+(p.delta||'');
 }
 if(method==='error')turn.error=p.error||p;
}
