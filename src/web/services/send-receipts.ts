export interface ReceiptTurn {id?:string;items?:Array<{id?:string;type?:string;localAccepted?:boolean;content?:unknown}>}
interface Receipt {id:string;content:unknown;status:string;seen:Set<string>;turnId?:string}
import {userContentKey} from '../../../shared/connection-state.js';

// Presentation only: never insert provisional items into native history/cache.
export function createSendReceipts() {
  const scopes = new Map<unknown,Receipt[]>();
  const messages = (turns:ReceiptTurn[]) => turns.flatMap(t => (t.items || []).filter(i => i.type === 'userMessage' && !i.localAccepted).map(i => ({id:JSON.stringify([t.id,i.id]),turnId:t.id,key:userContentKey(i.content)})));
  return {
    begin(scope:unknown, content:unknown, turns:ReceiptTurn[]) {
      const receipt = {id:crypto.randomUUID(),content,status:'sending',seen:new Set(messages(turns).map(i=>i.id))};
      const list=(scopes.get(scope)||[]).filter(r=>r.status!=='failed');list.push(receipt);scopes.set(scope,list);return receipt;
    },
    remove(scope:unknown,receipt:Receipt) {const list=(scopes.get(scope)||[]).filter(r=>r!==receipt);if(list.length)scopes.set(scope,list);else scopes.delete(scope);},
    accept(receipt:Receipt, result:{goalOnly?:unknown;turn?:{id?:string};turnId?:unknown}) {receipt.status=result.goalOnly?'confirmed':'accepted';receipt.turnId=result.turn?.id||result.turnId as string|undefined;},
    fail(receipt:Receipt, caught:unknown) {const error=caught as {status:number;code:string};receipt.status=error.status>=400&&error.status<500&&!['OUTCOME_UNKNOWN','SEND_PENDING'].includes(error.code)?'failed':'unknown';},
    view(scope:unknown, turns:ReceiptTurn[]) {
      const list=scopes.get(scope)||[];if(!list.length)return [];
      const native=messages(turns), remaining:Receipt[]=[];
      for(const receipt of list){
        // Goal-only submissions are confirmed by the native goal endpoint, not a userMessage.
        if(receipt.status==='confirmed')continue;
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
