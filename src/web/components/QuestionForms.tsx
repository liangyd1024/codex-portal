import {useLayoutEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
interface Question {id:string;question?:string;header?:string;options?:{label?:string;value?:string;description?:string}[]}
export interface QuestionRequest {kind?:string;params:{questions:Question[]};[field:string]:unknown}
interface Draft {collapsed?:boolean;skipped?:boolean;fields?:Record<string,{text?:string;choice?:string}>}
export interface QuestionOptions {drafts:{get:(request:QuestionRequest)=>Draft;set:(request:QuestionRequest,patch:Draft)=>void};submit:(answer:{answers:Record<string,{answers:string[]}>})=>unknown;rerender:()=>void}
interface View {collapsed:boolean;error:string;errorHidden:boolean;pending:boolean;unavailable:boolean}
export interface SavedField {name:string;value:string;checked?:boolean}
interface Props {request:QuestionRequest;options:QuestionOptions;savedFields?:SavedField[];pending:boolean;unavailable:boolean}
export function QuestionForm({request:r,options:{drafts,submit,rerender},savedFields,pending,unavailable}:Props){
 const formRef=useRef<HTMLFormElement>(null);
 const [saved]=useState(()=>drafts.get(r));
 const [store]=useState(()=>createStore<View>(()=>({collapsed:!!saved.collapsed,error:'',errorHidden:true,pending:false,unavailable:false})));
 const v=useStore(store);
 const patch=(view:Partial<View>)=>{const previous=store.getState();if(Object.entries(view).every(([key,value])=>Object.is(previous[key as keyof View],value)))return;flushSync(()=>store.setState(view));};
 const fields=useRef<{q:Question;text:HTMLTextAreaElement;radios:HTMLInputElement[]}[]>([]);
 useLayoutEffect(()=>{
  const form=formRef.current!;
  fields.current=r.params.questions.map((q,index)=>({q,text:form.querySelector<HTMLTextAreaElement>('[name="other-'+index+'"]')!,radios:[...form.querySelectorAll<HTMLInputElement>('[name="q-'+index+'"]')]}));
  for(const {q,text,radios} of fields.current){text.value=saved.fields?.[q.id]?.text||'';for(const radio of radios)radio.checked=saved.fields?.[q.id]?.choice===radio.value;}
  if(savedFields)for(const field of form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')){const found=savedFields.find(saved=>saved.name===field.name&&(field.type!=='radio'||saved.value===field.value));if(found){if(field instanceof HTMLInputElement&&field.type==='radio')field.checked=!!found.checked;else field.value=found.value;}}
  const persist=()=>{drafts.set(r,{fields:Object.fromEntries(fields.current.map(({q,text,radios})=>[q.id,{text:text.value,choice:radios.find(radio=>radio.checked)?.value||''}]))});patch({errorHidden:true});};
  let composing=false;
  const start=()=>{composing=true;},end=()=>{composing=false;};
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.stopPropagation();};
  const send=(e:SubmitEvent)=>{e.preventDefault();if(composing)return;const answers:Record<string,{answers:string[]}>= {};for(const {q,text,radios} of fields.current){const answer=text.value.trim()||radios.find(radio=>radio.checked)?.value;if(!answer){patch({error:'请回答所有问题。',errorHidden:false});text.focus();return;}answers[q.id]={answers:[answer]};}persist();submit({answers});};
  form.addEventListener('input',persist);form.addEventListener('change',persist);form.addEventListener('compositionstart',start);form.addEventListener('compositionend',end);form.addEventListener('keydown',keydown);form.addEventListener('submit',send);
  return ()=>{form.removeEventListener('input',persist);form.removeEventListener('change',persist);form.removeEventListener('compositionstart',start);form.removeEventListener('compositionend',end);form.removeEventListener('keydown',keydown);form.removeEventListener('submit',send);};
 },[]);
 const disabled=pending||unavailable;
 return <form ref={formRef} className="question-form"><div className="question-heading"><span className="">问题</span><button className="question-close" type="button" data-local="true" aria-label={v.collapsed?'展开问题':'收起问题'} disabled={pending} onClick={()=>{drafts.set(r,{collapsed:!drafts.get(r).collapsed});patch({collapsed:!!drafts.get(r).collapsed});}}>{v.collapsed?'展开':'×'}</button></div><div className="question-fields" hidden={v.collapsed}>{r.params.questions.map((q,index)=><fieldset className="question-group" key={index}><legend className="question-label">{q.question||q.header||q.id}</legend>{(q.options||[]).map((option,i)=>{const value=option.label||option.value||String(i);return <label className="question-option" key={i}><input className="" type="radio" name={'q-'+index} value={value} disabled={disabled}/><span className="">{value}{option.description?<small className="">{option.description}</small>:null}</span></label>;})}<textarea className="question-other" name={'other-'+index} placeholder="回复…" rows={1} aria-label={q.question||q.header||'回答'} disabled={disabled}/></fieldset>)}<p className="question-error" role="alert" hidden={v.errorHidden}>{v.error}</p><div className="request-actions">{r.kind==='asyncQuestion'?<button className="" type="button" data-local="true" disabled={pending} onClick={()=>{drafts.set(r,{skipped:true});rerender();}}>跳过</button>:null}<button className="accept" type="submit" data-question-send="true" disabled={disabled}>发送</button></div></div></form>;
}
