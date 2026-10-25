import type {ReceiptTurn} from './send-receipts';
import type {createSendReceipts} from '../../../public/connection-state.js';
interface Options {threads: unknown[]; skills?: unknown[]; plugins?: unknown[]; [key: string]: unknown}
interface Queued {id: string; [key: string]: unknown}
interface Result<Turn> {queuedSubmission?: Queued; turn?: Turn; [key: string]: unknown}
interface Payload {text: string; images: {url: string}[]; [key: string]: unknown}
interface Dependencies<Annotation, Draft extends {text: string}, Pictures extends {items: {url: string}[]}, Turn extends ReceiptTurn> {
 state: {selectedId: string | null; selectionVersion: number; desktopMode: boolean; busy: Set<string>; model: string; effort: string; detail: {queue?: {data?: Queued[]; [key: string]: unknown}} | null};
 input: () => Pick<HTMLTextAreaElement, 'value'>;
 disabled: () => boolean;
 newChatOpen: () => boolean;
 createThread: () => Promise<unknown>;
 sendDesktop: () => Promise<unknown>;
 host: () => string;
 captureAnnotation: () => Annotation;
 annotatedText: (text: string, annotation: Annotation) => string;
 acknowledgeAnnotation: (annotation: Annotation) => void;
 hasAttachments: () => boolean | undefined;
 attachmentsPending: () => boolean | undefined;
 captureAttachments: () => Pictures;
 acknowledgeAttachments: (pictures: Pictures) => void;
 captureDraft: (id: string, text: string) => Draft;
 acknowledgeDraft: (draft: Draft) => boolean;
 usable: () => boolean;
 controlled: () => boolean;
 running: () => boolean;
 touch: () => boolean;
 followUp: (context: {active: boolean; touch: boolean; alternate: boolean}) => string | null;
 validate: (text: string, active: boolean) => void;
 options: () => Options;
 goalPending: () => boolean;
 prepare: (id: string, text: string, active: boolean) => Promise<boolean>;
 send: (context: {goalStarted: boolean; id: string; payload: Payload; active: boolean}) => Promise<Result<Turn>>;
 post: (path: string, payload: Payload) => Promise<Result<Turn>>;
 receipts: ReturnType<typeof createSendReceipts>;
 turns: () => Turn[];
 action: (key: string, run: () => Promise<void>) => Promise<unknown>;
 renderMessages: () => void;
 followScroll: () => void;
 resize: () => void;
 upsert: (turn: Turn) => void;
 renderThread: () => void;
 refresh: () => Promise<unknown>;
 recordError: (error: unknown, stage: string) => void;
 toast: (message: string, error: boolean) => void;
}
export function createMessageSend<Annotation, Draft extends {text: string}, Pictures extends {items: {url: string}[]}, Turn extends ReceiptTurn>(d: Dependencies<Annotation, Draft, Pictures, Turn>) {
 const {state} = d;
 return async function sendMessage(event?: Pick<Event, 'preventDefault'>, alternate=false) {
  event?.preventDefault();
  if (d.disabled() && !alternate) return;
  if (d.newChatOpen()) {await d.createThread();return;}
  if (state.desktopMode) {await d.sendDesktop();return;}
  const annotation = d.captureAnnotation();
  const text = d.annotatedText(d.input().value.trim(), annotation), id = state.selectedId;
  if ((!text && !d.hasAttachments()) || d.attachmentsPending() || !id || !d.usable() || !d.controlled() || state.busy.has('message')) return;
  const active = d.running(), selection = state.selectionVersion;
  const followUp = d.followUp({active,touch:d.touch(),alternate});
  try {d.validate(text,active);} catch (error) {d.toast((error as Error).message,true);return;}
  const sent = d.captureDraft(id,d.input().value), pictures = d.captureAttachments();
  await d.action('message',async () => {
   const images = pictures.items.map(i=>({url:i.url}));
   const options = d.options();
   if(options.threads.length && followUp==='queue') throw new Error('排队暂不支持会话引用，请使用“引导”发送。草稿已保留。');
   if(options.threads.length && !active && d.goalPending()) throw new Error('暂不能同时启动目标并发送会话引用，请先发送引用或取消目标模式。草稿已保留。');
   const payload: Payload = active ? {text,images,skills:options.skills,plugins:options.plugins,threads:options.threads} : {text,images,model:state.model,effort:state.effort,...options};
   const scope = d.host()+':'+id;
   const content = [...(text?[{type:'text',text}]:[]),...images.map(i=>({type:'image',url:i.url}))];
   const receipt = d.receipts.begin(scope,content,d.turns());
   d.renderMessages();d.followScroll();
   let result: Result<Turn>, submitted=false;
   try {
    const goalStarted=await d.prepare(id,text,active);
    submitted=true;
    result=followUp==='queue'?await d.post('/api/threads/'+encodeURIComponent(id)+'/queue-add',payload):await d.send({goalStarted,id,payload,active});
    if(result.queuedSubmission){d.receipts.remove(scope,receipt);if(scope===d.host()+':'+state.selectedId&&selection===state.selectionVersion&&state.detail){const queue=state.detail.queue||{data:[]};state.detail.queue={...queue,data:[...(queue.data||[]).filter(q=>q.id!==result.queuedSubmission!.id),result.queuedSubmission]};}}
    else d.receipts.accept(receipt,result);
   } catch(error) {
    if(submitted)d.receipts.fail(receipt,error);else receipt.status='failed';
    if(scope===d.host()+':'+state.selectedId)d.renderMessages();
    throw error;
   }
   d.acknowledgeAttachments(pictures);d.acknowledgeAnnotation(annotation);
   const cleared=d.acknowledgeDraft(sent);
   if(scope===d.host()+':'+state.selectedId&&cleared&&d.input().value===sent.text){d.input().value='';d.resize();}
   if(scope===d.host()+':'+state.selectedId&&selection===state.selectionVersion){if(result.turn)d.upsert(result.turn);d.renderThread();}
   // Native acceptance releases the submission lock before asynchronous detail reads.
   if(scope===d.host()+':'+state.selectedId&&selection===state.selectionVersion)void d.refresh().catch(error=>d.recordError(error,'thread'));
  });
 };
}
