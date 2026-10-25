import {mergeLiveTurns,userContentKey} from '../../../public/connection-state.js';
export interface LiveItem {id?:string;type:string;content?:unknown;localAccepted?:boolean;[field:string]:unknown}
export interface LiveTurn {id?:string;items:LiveItem[];[field:string]:unknown}
interface Dependencies {state:{detail:{turns?:LiveTurn[];[field:string]:unknown}|null};turns:()=>LiveTurn[]}
/** Reuse native transcript reconciliation; do not introduce a second transcript. */
export function createLiveTurns({state,turns}:Dependencies){
 function upsertTurn(t:LiveTurn){
  if(!state.detail)return;
  state.detail.turns=mergeLiveTurns(turns(),[t]);
 }
 function ensureTurn(id:string|undefined):LiveTurn|null{
  if(!state.detail)return null;
  let t=turns().find(t=>t.id===id);
  if(!t){t={id:id||'live',status:'inProgress',items:[]};state.detail.turns=[...turns(),t];}
  return t;
 }
 function upsertItem(turnId:string|undefined,item:LiveItem){
  const t=ensureTurn(turnId);if(!t)return;
  if(item.type==='userMessage')t.items=t.items.filter(old=>!old.localAccepted||userContentKey(old.content)!==userContentKey(item.content));
  const i=t.items.findIndex(x=>x.id===item.id);
  if(i>=0)t.items[i]=mergeLiveTurns([{id:turnId,items:[t.items[i]]}],[{id:turnId,items:[item]}])[0].items[0];
  else t.items.push(item);
 }
 return {upsertTurn,ensureTurn,upsertItem};
}
