import {userMessageContent} from '../../../public/message-media.js';
import type {NativeItem,NativeStatus} from '../../contracts/native';

export interface NavigationTurn {
 id?:string;items?:NativeItem[];status?:NativeStatus;startedAt?:number|string;createdAt?:number|string;
 [field:string]:unknown;
}
interface HistoryContext {hasEarlier?:boolean;cursor?:string|null;loading?:boolean}
interface EarlierOptions {
 context:()=>HistoryContext;loadEarlier:()=>Promise<boolean|undefined>;isCurrent:()=>boolean;
 onProgress?:()=>void;yieldPage?:()=>Promise<unknown>;waitForPage?:()=>Promise<unknown>;
}
interface TargetOptions {
 context:()=>HistoryContext & {turns:NavigationTurn[]};
 loadEarlier:(options:{deferRender:boolean})=>Promise<boolean|undefined>;isCurrent:()=>boolean;wait?:()=>Promise<unknown>;
}
interface CountContext extends HistoryContext {turns?:NavigationTurn[];loadMessage?:string}

const questionItem=(turn:NavigationTurn)=>(turn.items||[]).find(i=>i.type==='userMessage'||i.type==='goalMessage');
// Navigation follows explicit inputs. Native continuation turns remain in the transcript.
export function navigationIndex<T extends NavigationTurn>(turns:T[]=[]) {
  const inputs:T[]=[],owners=new Map<string|undefined,string|undefined>();let owner:string|undefined;
  for(const turn of turns){if(questionItem(turn)){inputs.push(turn);owner=turn.id;}owners.set(turn.id,owner);}
  return {inputs,owners};
}

const clip=(text:unknown,length:number)=>{const chars=Array.from(String(text||''));return chars.length>length?chars.slice(0,length).join('')+'…':chars.join('');};
export function turnPreview(turn:NavigationTurn,{uncertain=false}={}) {
  const items=turn.items||[],question=questionItem(turn);
  const input:{text?:unknown;images?:unknown[]}=question?.type==='goalMessage'?{text:question.objective}:userMessageContent(question?.content);
  const answer=items.find(i=>i.type==='agentMessage'&&i.phase==='final_answer'&&i.text?.trim())||items.find(i=>i.type==='agentMessage'&&i.text?.trim());
  const status=(turn.status as {type?:string}|null|undefined)?.type||turn.status;
  const running=['inProgress','in_progress','running'].includes(status as string);
  return {id:turn.id,question:clip(input.text|| (input.images?.length?'图片消息':question?'用户消息':'继续执行'),180),answer:clip(answer?.text,1000),status:uncertain&&running?'状态待确认':running?'正在执行':(({failed:'执行失败',interrupted:'已中断',completed:'已完成'} as Record<string,string>)[status as string]||'状态待确认'),running:running&&!uncertain,time:turn.startedAt||turn.createdAt};
}
// Read one page at a time. A changed context or cancellation stops further requests.
export async function loadAllEarlier({context,loadEarlier,isCurrent,onProgress=()=>{},yieldPage=()=>new Promise(resolve=>setTimeout(resolve,0)),waitForPage=()=>new Promise(resolve=>setTimeout(resolve,25))}:EarlierOptions) {
  const seen=new Set<string|null|undefined>();
  while(isCurrent()&&context().hasEarlier){
    const {cursor,loading}=context();
    if(loading){await waitForPage();continue;}
    if(seen.has(cursor))return false;
    seen.add(cursor);
    if(!await loadEarlier())return false;
    if(!isCurrent())return false;
    onProgress();
    await yieldPage();
  }
  return isCurrent();
}
export async function loadTurnUntil(id:string|undefined,{context,loadEarlier,isCurrent,wait=()=>new Promise(r=>setTimeout(r,25))}:TargetOptions) {
  const seen=new Set<string|null|undefined>();
  while(isCurrent()){
    const c=context();
    if(c.turns.some(t=>t.id===id))return true;
    if(!c.hasEarlier)return false;
    if(c.loading){await wait();continue;}
    if(seen.has(c.cursor))return false;
    seen.add(c.cursor);
    if(!await loadEarlier({deferRender:true}))return false;
  }
  return false;
}
export function turnCountLabel({turns=[],hasEarlier,loading=false,loadMessage=''}:CountContext,count=navigationIndex(turns).inputs.length) {
  // The engine total includes automatic executions, not just explicit inputs.
  if(loading||hasEarlier)return !loading&&loadMessage?'点击重试':'';
  return '共 '+count+' 轮';
}
