import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Question {id:string;question?:string;header?:string;options?:{label?:string;value?:string;description?:string}[]}
interface Request {kind?:string;params:{questions:Question[]};[field:string]:unknown}
interface Draft {collapsed?:boolean;skipped?:boolean;fields?:Record<string,{text?:string;choice?:string}>}
interface Options {drafts:{get:(request:Request)=>Draft;set:(request:Request,patch:Draft)=>void};submit:(answer:{answers:Record<string,{answers:string[]}>})=>unknown;rerender:()=>void}
interface View {collapsed:boolean;error:string;errorHidden:boolean;pending:boolean;unavailable:boolean}
interface SavedField {name:string;value:string;checked?:boolean}
interface Instance {id:number;form:HTMLFormElement;request:Request;options:Options;saved:Draft;store:StoreApi<View>}
interface Availability {ready:boolean;pending:(id:string)=>boolean;controlledThreads?:string[]}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function patch(instance:Instance,view:Partial<View>){const previous=instance.store.getState();if(Object.entries(view).every(([key,value])=>Object.is(previous[key as keyof View],value)))return;flushSync(()=>instance.store.setState(view));}
function Form({instance}:{instance:Instance}){
 const {form,request:r,options:{drafts,submit,rerender},saved}=instance,v=useStore(instance.store);
 const fields=useRef<{q:Question;text:HTMLTextAreaElement;radios:HTMLInputElement[]}[]>([]);
 useLayoutEffect(()=>{
  fields.current=r.params.questions.map((q,index)=>({q,text:form.querySelector<HTMLTextAreaElement>('[name="other-'+index+'"]')!,radios:[...form.querySelectorAll<HTMLInputElement>('[name="q-'+index+'"]')]}));
  for(const {q,text,radios} of fields.current){text.value=saved.fields?.[q.id]?.text||'';for(const radio of radios)radio.checked=saved.fields?.[q.id]?.choice===radio.value;}
  const persist=()=>{drafts.set(r,{fields:Object.fromEntries(fields.current.map(({q,text,radios})=>[q.id,{text:text.value,choice:radios.find(radio=>radio.checked)?.value||''}]))});patch(instance,{errorHidden:true});};
  let composing=false;
  const start=()=>{composing=true;},end=()=>{composing=false;};
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.stopPropagation();};
  const send=(e:SubmitEvent)=>{e.preventDefault();if(composing)return;const answers:Record<string,{answers:string[]}>= {};for(const {q,text,radios} of fields.current){const answer=text.value.trim()||radios.find(radio=>radio.checked)?.value;if(!answer){patch(instance,{error:'请回答所有问题。',errorHidden:false});text.focus();return;}answers[q.id]={answers:[answer]};}persist();submit({answers});};
  form.addEventListener('input',persist);form.addEventListener('change',persist);form.addEventListener('compositionstart',start);form.addEventListener('compositionend',end);form.addEventListener('keydown',keydown);form.addEventListener('submit',send);
  return ()=>{form.removeEventListener('input',persist);form.removeEventListener('change',persist);form.removeEventListener('compositionstart',start);form.removeEventListener('compositionend',end);form.removeEventListener('keydown',keydown);form.removeEventListener('submit',send);};
 },[instance]);
 const disabled=v.pending||v.unavailable;
 return createPortal(<><div className="question-heading"><span className="">问题</span><button className="question-close" type="button" data-local="true" aria-label={v.collapsed?'展开问题':'收起问题'} disabled={v.pending} onClick={()=>{drafts.set(r,{collapsed:!drafts.get(r).collapsed});patch(instance,{collapsed:!!drafts.get(r).collapsed});}}>{v.collapsed?'展开':'×'}</button></div><div className="question-fields" hidden={v.collapsed}>{r.params.questions.map((q,index)=><fieldset className="question-group" key={index}><legend className="question-label">{q.question||q.header||q.id}</legend>{(q.options||[]).map((option,i)=>{const value=option.label||option.value||String(i);return <label className="question-option" key={i}><input className="" type="radio" name={'q-'+index} value={value} disabled={disabled}/><span className="">{value}{option.description?<small className="">{option.description}</small>:null}</span></label>;})}<textarea className="question-other" name={'other-'+index} placeholder="回复…" rows={1} aria-label={q.question||q.header||'回答'} disabled={disabled}/></fieldset>)}<p className="question-error" role="alert" hidden={v.errorHidden}>{v.error}</p><div className="request-actions">{r.kind==='asyncQuestion'?<button className="" type="button" data-local="true" disabled={v.pending} onClick={()=>{drafts.set(r,{skipped:true});rerender();}}>跳过</button>:null}<button className="accept" type="submit" data-question-send="true" disabled={disabled}>发送</button></div></div></>,form);
}
export function QuestionForms(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Form key={instance.id} instance={instance}/>)}</>;}
export const reactQuestionForms={
 create(request:Request,options:Options){const form=document.createElement('form');form.className='question-form';const saved=options.drafts.get(request),instance:Instance={id:++sequence,form,request,options,saved,store:createStore<View>(()=>({collapsed:!!saved.collapsed,error:'',errorHidden:true,pending:false,unavailable:false}))};flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));return form;},
 release(){if(registry.getState().instances.length)flushSync(()=>registry.setState({instances:[]}));},
 restore(form:HTMLFormElement,fields:SavedField[]){if(!registry.getState().instances.some(i=>i.form===form))return;form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea').forEach(field=>{const found=fields.find(saved=>saved.name===field.name&&(field.type!=='radio'||saved.value===field.value));if(found){if(field instanceof HTMLInputElement&&field.type==='radio')field.checked=!!found.checked;else field.value=found.value;}});},
 sync({ready,pending,controlledThreads}:Availability){const updates:(()=>void)[]=[];for(const instance of registry.getState().instances){const card=instance.form.closest<HTMLElement>('.request-card');if(!card)continue;const next={pending:pending(card.dataset.requestId!),unavailable:!ready||(card.dataset.asyncQuestion==='true'&&!controlledThreads?.includes(card.dataset.threadId!))};const previous=instance.store.getState();if(previous.pending!==next.pending||previous.unavailable!==next.unavailable)updates.push(()=>instance.store.setState(next));}if(updates.length)flushSync(()=>updates.forEach(update=>update()));}
};
