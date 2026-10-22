export function questionForm(r,{drafts,submit,rerender}) {
  const make=(tag,className,text)=>{const n=document.createElement(tag);n.className=className||'';if(text!=null)n.textContent=text;return n;};
  const form=make('form','question-form'),saved=drafts.get(r),async=r.kind==='asyncQuestion';
  const header=make('div','question-heading'),title=make('span','','问题');header.append(title);
  const close=make('button','question-close','×');close.type='button';close.dataset.local='true';close.setAttribute('aria-label',saved.collapsed?'展开问题':'收起问题');
  header.append(close);form.append(header);
  const body=make('div','question-fields');body.hidden=!!saved.collapsed;
  close.onclick=()=>{drafts.set(r,{collapsed:!drafts.get(r).collapsed});body.hidden=!!drafts.get(r).collapsed;close.setAttribute('aria-label',body.hidden?'展开问题':'收起问题');close.textContent=body.hidden?'展开':'×';};
  if(saved.collapsed)close.textContent='展开';
  const fields=[];
  for(const [index,q] of r.params.questions.entries()){
    const group=make('fieldset','question-group');group.append(make('legend','question-label',q.question||q.header||q.id));
    const radios=[];
    for(const [oi,opt] of (q.options||[]).entries()){
      const label=make('label','question-option'),input=make('input');input.type='radio';input.name='q-'+index;input.value=opt.label||opt.value||String(oi);input.checked=saved.fields?.[q.id]?.choice===input.value;
      const copy=make('span','',input.value);if(opt.description)copy.append(make('small','',opt.description));label.append(input,copy);group.append(label);radios.push(input);
    }
    const text=make('textarea','question-other');text.name='other-'+index;text.placeholder='回复…';text.rows=1;text.value=saved.fields?.[q.id]?.text||'';text.setAttribute('aria-label',q.question||q.header||'回答');group.append(text);body.append(group);
    fields.push({q,text,radios});
  }
  const error=make('p','question-error');error.setAttribute('role','alert');error.hidden=true;body.append(error);
  const actions=make('div','request-actions');
  if(async){const skip=make('button','','跳过');skip.type='button';skip.dataset.local='true';skip.onclick=()=>{drafts.set(r,{skipped:true});rerender();};actions.append(skip);}
  const send=make('button','accept','发送');send.type='submit';send.dataset.questionSend='true';actions.append(send);body.append(actions);form.append(body);
  const persist=()=>{drafts.set(r,{fields:Object.fromEntries(fields.map(({q,text,radios})=>[q.id,{text:text.value,choice:radios.find(r=>r.checked)?.value||''}]))});error.hidden=true;};
  form.addEventListener('input',persist);form.addEventListener('change',persist);
  let composing=false;form.addEventListener('compositionstart',()=>{composing=true;});form.addEventListener('compositionend',()=>{composing=false;});
  form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.stopPropagation();});
  form.onsubmit=e=>{
    e.preventDefault();if(composing)return;
    const answers={};for(const {q,text,radios} of fields){const answer=text.value.trim()||radios.find(r=>r.checked)?.value;if(!answer){error.textContent='请回答所有问题。';error.hidden=false;text.focus();return;}answers[q.id]={answers:[answer]};}
    persist();submit({answers});
  };
  return form;
}
