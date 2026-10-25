import type {Request} from './request-response';
import type {CardView} from '../components/RequestCards';
import type {QuestionRequest,QuestionOptions} from '../components/QuestionForms';
interface DisplayRequest extends Request {
 method?:string;
 params?:NonNullable<Request['params']>&{questions?:QuestionRequest['params']['questions'];reason?:unknown;command?:unknown;cwd?:unknown;changes?:{path?:unknown}[];availableDecisions?:string[]};
}
interface Thread {id:string;[field:string]:unknown}
type Draft=ReturnType<QuestionOptions['drafts']['get']>&{sent?:boolean};
interface Dependencies {
 state:{selectedId:string|null;requestSignature:string;threads:Thread[]};
 sidebar:{menu?:unknown;dialog?:unknown;drag?:unknown};
 sideChat:()=>{id?:string;requestsHost:HTMLElement}|null|undefined;
 requests:()=>DisplayRequest[];
 questionDrafts:{get:(request:Request|QuestionRequest)=>Draft;set:(request:Request|QuestionRequest,patch:Draft)=>void};
 document:Pick<Document,'querySelectorAll'>;
 element:(id:'conversation-requests')=>HTMLElement;
 renderControls:()=>void;renderThreads:()=>void;
 notifyTaskEvent:(method:string,request:DisplayRequest)=>unknown;
 requestThread:(request:DisplayRequest)=>string|undefined;requestPath:(request:DisplayRequest)=>string;
 currentThread:()=>Thread|null|undefined;threadName:(thread:Thread)=>string;
 pretty:(value:unknown)=>string;
 respondRequest:(request:DisplayRequest,answer:Record<string,unknown>)=>unknown;
 publishRequestCards:(views:CardView[])=>void;
}
function hasQuestions(r:DisplayRequest):r is DisplayRequest&QuestionRequest{return Array.isArray(r.params?.questions)&&r.params.questions.length>0;}
export function createRequestRenderer(d:Dependencies){
 const {state,sidebar,sideChat,requests,questionDrafts,document,element:$,renderControls,renderThreads,notifyTaskEvent,requestThread,requestPath,currentThread,threadName,pretty,respondRequest,publishRequestCards}=d;
function renderRequests() {
  const list = requests().filter(r=>!questionDrafts.get(r).sent), signature = JSON.stringify([state.selectedId,sideChat()?.id,list]);
  if (signature === state.requestSignature) { renderControls(); return; }
  state.requestSignature = signature;
  for(const r of list)if(r.params?.questions?.length)notifyTaskEvent('manager/request',r);
  if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();
  const saved = new Map([...document.querySelectorAll<HTMLElement>('.request-card')].map(card => [card.dataset.requestId, {fields:[...card.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')].map(f => ({name:f.name,value:f.value,checked:'checked' in f?f.checked:undefined})),open:Boolean(card.querySelector('details[open]'))}]));
  const views:CardView[]=[];
  list.forEach(r => {
    const threadId=requestThread(r);
    if(threadId&&threadId!==state.selectedId&&threadId!==sideChat()?.id)return;
    const method=r.method||'',p=r.params||{},question=hasQuestions(r);
    const knownApproval=/requestApproval|approval|requestPermissions/i.test(method)||['approval','commandApproval','fileApproval','command','file','permissions'].includes(r.kind??'');
    const title=question?'需要你的回答':/commandExecution/i.test(method)?'命令执行审批':/fileChange/i.test(method)?'文件修改审批':/requestPermissions/i.test(method)?'权限请求':knownApproval?'操作审批':'工具请求待处理';
    const target=threadId&&!question?(currentThread()?.id===threadId?currentThread():state.threads.find(t=>t.id===threadId)):null;
    const rerender=()=>{state.requestSignature='';renderRequests();};
    views.push({host:sideChat()?.id&&threadId===sideChat()?.id?sideChat()!.requestsHost:$('conversation-requests'),id:requestPath(r),threadId:threadId||'',asyncQuestion:r.kind==='asyncQuestion',title,
      origin:threadId&&!question?'会话：'+(target?threadName(target):threadId):undefined,reason:p.reason?String(p.reason):undefined,command:p.command?String(p.command):undefined,cwd:p.cwd?String(p.cwd):undefined,changes:Array.isArray(p.changes)?p.changes.map(c=>({path:c.path==null?'':String(c.path)})):undefined,
      knownApproval,availableDecisions:p.availableDecisions,detail:pretty({method,params:p}),respond:answer=>respondRequest(r,answer),previous:saved.get(requestPath(r)),
      question:question?{request:r,options:{drafts:questionDrafts,submit:answer=>respondRequest(r,answer),rerender},skipped:!!questionDrafts.get(r).skipped,restore:()=>{questionDrafts.set(r,{skipped:false,collapsed:false});rerender();}}:undefined});
  });
  publishRequestCards(views);
  renderControls();
}

 return renderRequests;
}
