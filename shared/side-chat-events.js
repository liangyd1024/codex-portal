// A disposable view cache of original native events, never an execution state.
export function applySideEvent(turns,method,p){
 const id=p.turnId||p.turn?.id;if(!id)return;
 let turn=turns.find(t=>t.id===id);if(!turn){turn={id,items:[]};turns.push(turn);}
 if(p.turn){const items=turn.items;Object.assign(turn,p.turn);if(!p.turn.items?.length)turn.items=items;}
 if(p.item){const index=turn.items.findIndex(i=>i.id===p.item.id);if(index<0)turn.items.push({...p.item});else turn.items[index]={...p.item};}
 if(method==='item/agentMessage/delta'){
  let item=turn.items.find(i=>i.id===p.itemId);if(!item){item={id:p.itemId,type:'agentMessage',text:''};turn.items.push(item);}item.text+=p.delta||'';
 }
}
