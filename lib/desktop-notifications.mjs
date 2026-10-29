// Version 11 desktop stream uses Immer patches with array paths. Retain only
// notification state; assistant/tool bodies remain in the native history store.
const fields=new Set(['turns','turnHistory','threadGoal']);
const forbidden=new Set(['__proto__','prototype','constructor']);
function project(value){
 if(Array.isArray(value))return value.map(project);
 if(!value||typeof value!=='object')return value;
 if(value.turnId!==undefined&&value.status!==undefined)return {turnId:value.turnId,status:value.status};
 return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='items'&&!forbidden.has(key)).map(([key,v])=>[key,project(v)]));
}
function relevant(path){
 if(path[0]==='turns'&&path.length>2)return ['turnId','id','status'].includes(path[2]);
 if(path[0]==='turnHistory'&&path[1]==='history'&&path[2]==='entitiesByKey'&&path.length>4)return ['turnId','id','status'].includes(path[4]);
 return fields.has(path[0]);
}
function turns(state){
 const h=state.turnHistory;
 if(h?.kind==='canonical')return (h.history?.islands||[]).flatMap(i=>(i.entries||[]).map(e=>h.history.entitiesByKey?.[e.value])).filter(Boolean);
 return state.turns||[];
}
export class DesktopNotifications {
 constructor(emit){this.emit=emit;this.states=new Map();this.turnGoals=new Map();}
 clear(id){if(id){this.states.delete(id);this.turnGoals.delete(id);}else{this.states.clear();this.turnGoals.clear();}}
 snapshot(id,state){this.states.set(id,Object.fromEntries([...fields].filter(k=>Object.hasOwn(state,k)).map(k=>[k,project(state[k])])));this.turnGoals.set(id,new Map(turns(state).filter(t=>t.status==='inProgress').map(t=>[t.turnId||t.id,state.threadGoal?.status==='active'?structuredClone(state.threadGoal):null])));}
 patches(id,patches){
 const state=this.states.get(id);if(!state)return;
 if(!Array.isArray(patches))throw Error('Invalid desktop patches');
 patches=patches.filter(p=>!Array.isArray(p.path)||p.path.some(k=>forbidden.has(k))||relevant(p.path)&&!p.path.includes('items'));
 if(!patches.length)return;
 const associations=this.turnGoals.get(id);
 const before=new Map(turns(state).map(t=>[t.turnId||t.id,t.status]));
 const previousGoal=structuredClone(state.threadGoal);
 let changed=false;
 for(const patch of patches){
  const p=patch.path;
  if(!Array.isArray(p)||p.some(k=>forbidden.has(k)))throw Error('Invalid desktop patch path');
  if(!fields.has(p[0])||p.includes('items'))continue;
  if(!['add','replace','remove'].includes(patch.op))throw Error('Unsupported desktop patch');
  let target=state;
  for(const key of p.slice(0,-1)){if(!target||!Object.hasOwn(target,key))throw Error('Missing desktop patch parent');target=target[key];}
  const key=p.at(-1);
  if(!target||typeof target!=='object')throw Error('Invalid desktop patch parent');
  if(Array.isArray(target)){
   if(!Number.isInteger(key)||key<0||key>target.length)throw Error('Invalid desktop array patch');
   if(patch.op==='remove')target.splice(key,1);
   else if(patch.op==='add')target.splice(key,0,project(patch.value));
   else target[key]=project(patch.value);
  }else if(patch.op==='remove')delete target[key];else target[key]=project(patch.value);
  changed=true;
 }
 if(!changed)return;
 const goal=state.threadGoal;
 if(goal&&previousGoal?.status==='active'&&goal.createdAt===previousGoal.createdAt&&JSON.stringify(goal)!==JSON.stringify(previousGoal))this.emit('thread/goal/updated',{threadId:id,goal});
 for(const turn of turns(state)){
  const turnId=turn.turnId||turn.id;
  if(turn.status==='inProgress'&&goal?.status==='active')associations.set(turnId,structuredClone(goal));
  // Only an observed running turn can finish. History hydration is never a
  // completion event, even when it introduces previously unseen terminal IDs.
  if(before.get(turnId)!=='inProgress'||!['completed','failed','interrupted'].includes(turn.status))continue;
  const tracked=associations.get(turnId);
  const associated=tracked?(goal?.createdAt===tracked.createdAt?goal:tracked):(goal?.status==='active'?goal:null);
  associations.delete(turnId);
  this.emit('manager/notification',{threadId:id,sourceMethod:'turn/completed',notificationGoal:associated??null,
   notificationGoalKnown:Object.hasOwn(state,'threadGoal'),turn:{id:turnId,status:turn.status}});
 }
 }
}
