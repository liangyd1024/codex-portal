import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {QuestionForm,type QuestionRequest,type QuestionOptions,type SavedField} from './QuestionForms';
interface CardView {
 host:HTMLElement;id:string;threadId:string;asyncQuestion:boolean;title:string;origin?:string;
 reason?:string;command?:string;cwd?:string;changes?:{path:string}[];detail:string;knownApproval:boolean;
 availableDecisions?:string[];question?:{request:QuestionRequest;options:QuestionOptions;skipped:boolean;restore:()=>void};
 previous?:{fields:SavedField[];open:boolean};respond:(answer:{decision:string})=>unknown;
}
interface Card extends CardView {key:number;pending:boolean;unavailable:boolean;feedback:string}
interface Availability {ready:boolean;pending:(id:string)=>boolean;controlledThreads?:string[]}
const registry=createStore<{cards:Card[]}>(()=>({cards:[]}));let sequence=0;
function RequestCard({card:c}:{card:Card}){
 const detail=useRef<HTMLDetailsElement>(null);
 useLayoutEffect(()=>{if(c.previous?.open&&detail.current)detail.current.open=true;},[]);
 const disabled=c.pending||c.unavailable;
 const available=c.availableDecisions;
 const offered=(decision:string)=>!Array.isArray(available)||!available.length||available.includes(decision);
 return <div className="request-card" data-request-id={c.id} data-async-question={String(c.asyncQuestion)} data-thread-id={c.threadId} aria-busy={String(c.pending) as 'true'|'false'}>
 {!c.question&&<h4>{c.title}</h4>}
 {c.origin&&<p className="request-origin">{c.origin}</p>}
 {c.reason&&<p>{c.reason}</p>}{c.command&&<pre>{c.command}</pre>}{c.cwd&&<p>{'目标机器目录：'+c.cwd}</p>}
 {c.changes?.map((change,i)=><p key={i}>{change.path}</p>)}
 {c.question?(c.question.skipped?<><p className="subtle">已跳过问题</p><button className="text-button" data-local="true" disabled={c.pending} onClick={c.question.restore}>重新回答</button></>:<QuestionForm request={c.question.request} options={c.question.options} savedFields={c.previous?.fields} pending={c.pending} unavailable={c.unavailable}/>):<>
 {!c.knownApproval&&<p>此工具需要专用实现。请查看请求详情。可以取消请求，避免会话一直等待。</p>}
 <details className="request-detail" ref={detail}><summary>请求详情</summary><pre>{c.detail}</pre></details>
 <div className="request-actions">
 {c.knownApproval&&<>{offered('accept')&&<button className="accept" disabled={disabled} onClick={()=>c.respond({decision:'accept'})}>允许一次</button>}{available?.includes('acceptForSession')&&<button className="accept" disabled={disabled} onClick={()=>c.respond({decision:'acceptForSession'})}>本会话允许</button>}{offered('decline')&&<button disabled={disabled} onClick={()=>c.respond({decision:'decline'})}>拒绝</button>}</>}
 {offered('cancel')&&<button disabled={disabled} onClick={()=>c.respond({decision:'cancel'})}>取消请求</button>}
 </div></>}
 <p className="request-feedback subtle" role="status" hidden={!c.feedback}>{c.feedback}</p>
 </div>;
}
export function RequestCards(){const cards=useStore(registry).cards;return <>{cards.map(card=>createPortal(<RequestCard card={card}/>,card.host,String(card.key)))}</>;}
export function publishRequestCards(views:CardView[]){flushSync(()=>registry.setState({cards:views.map(view=>({...view,key:++sequence,pending:false,unavailable:false,feedback:''}))}));}
export function clearRequestCards(host:HTMLElement){const cards=registry.getState().cards;if(cards.some(c=>c.host===host))flushSync(()=>registry.setState({cards:cards.filter(c=>c.host!==host)}));}
export function syncRequestCards({ready,pending,controlledThreads}:Availability){
 let changed=false;
 const cards=registry.getState().cards.map(c=>{
  const busy=pending(c.id),viewOnly=c.asyncQuestion&&!controlledThreads?.includes(c.threadId),unavailable=!ready||viewOnly;
  const feedback=busy?'正在提交，请稍候…':viewOnly?'查看模式，请在原操作入口回答。':!ready?'连接恢复后可处理此请求，已填内容会保留。':'';
  if(c.pending===busy&&c.unavailable===unavailable&&c.feedback===feedback)return c;
  changed=true;return {...c,pending:busy,unavailable,feedback};
 });
 if(changed)flushSync(()=>registry.setState({cards}));
}
