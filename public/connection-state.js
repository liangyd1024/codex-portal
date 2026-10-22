export * from '../shared/connection-state.js';

import {userContentKey} from '../shared/connection-state.js';

// Presentation only: never insert provisional items into native history/cache.
export function createSendReceipts() {
  const scopes = new Map();
  const messages = turns => turns.flatMap(t => (t.items || []).filter(i => i.type === 'userMessage' && !i.localAccepted).map(i => ({id:JSON.stringify([t.id,i.id]),turnId:t.id,key:userContentKey(i.content)})));
  return {
    begin(scope, content, turns) {
      const receipt = {id:crypto.randomUUID(),content,status:'sending',seen:new Set(messages(turns).map(i=>i.id))};
      const list=(scopes.get(scope)||[]).filter(r=>r.status!=='failed');list.push(receipt);scopes.set(scope,list);return receipt;
    },
    remove(scope,receipt) {const list=(scopes.get(scope)||[]).filter(r=>r!==receipt);if(list.length)scopes.set(scope,list);else scopes.delete(scope);},
    accept(receipt, result) {receipt.status='accepted';receipt.turnId=result.turn?.id||result.turnId;},
    fail(receipt, error) {receipt.status=error.status>=400&&error.status<500&&!['OUTCOME_UNKNOWN','SEND_PENDING'].includes(error.code)?'failed':'unknown';},
    view(scope, turns) {
      const list=scopes.get(scope)||[];if(!list.length)return [];
      const native=messages(turns), remaining=[];
      for(const receipt of list){
        const match=receipt.status!=='failed'&&native.find(i=>!receipt.seen.has(i.id)&&(!receipt.turnId||receipt.turnId===i.turnId)&&i.key===userContentKey(receipt.content));
        if(match){for(const other of list)other.seen.add(match.id);}
        else remaining.push(receipt);
      }
      if(remaining.length)scopes.set(scope,remaining);else scopes.delete(scope);
      return remaining;
    },
  };
}

export const sendReceiptLabels = {sending:'正在发送…',accepted:'已发送，正在同步会话…',failed:'发送失败，草稿已保留。',unknown:'发送结果待确认，请勿重复发送。草稿已保留。'};
