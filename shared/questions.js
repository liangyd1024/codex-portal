// Codex async questions live on agentMessage items; replies retain the original IDs.
export function questionReplies(item) {
  if(item?.type==='steeringUserMessage'&&item.status!=='accepted')return [];
  const content=item?.type==='userMessage'?item.content:item?.type==='steeringUserMessage'?item.input:null;
  if(!Array.isArray(content)||content.length!==1||content[0]?.type!=='text')return [];
  const match=/^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(content[0].text||'');
  if(!match)return [];
  try{const parsed=JSON.parse(match[1]),values=Array.isArray(parsed)?parsed:[parsed];return values.filter(v=>typeof v?.questionItemId==='string'&&typeof v.question==='string'&&typeof v.answer==='string');}catch{return [];}
}
export function asyncQuestions(turns,threadId) {
  const active=(turns||[]).filter(t=>t.status==='inProgress');
  if(!active.length)return [];
  const answered=new Set((turns||[]).flatMap(t=>(t.items||[]).flatMap(questionReplies)).map(r=>r.questionItemId));
  return active.flatMap(turn=>(turn.items||[]).flatMap(item=>{
    if(item.type!=='agentMessage'||typeof item.id!=='string'||!Array.isArray(item.questions))return [];
    const questions=item.questions.flatMap((q,index)=>{
      const id=JSON.stringify(['request_user_input_async',item.id,index]);
      return typeof q?.title==='string'&&q.title.trim()&&!answered.has(id)?[{id,question:q.title,options:(q.options||[]).filter(o=>typeof o==='string').map(label=>({label}))}]:[];
    });
    const id='async:'+JSON.stringify([threadId,turn.id,item.id]);
    return questions.length?[{id,key:id,kind:'asyncQuestion',threadId,params:{threadId,turnId:turn.id,itemId:item.id,questions}}]:[];
  }));
}
export function replyText(questions,answers) {
  return '<send_user_message_question_reply>\n'+JSON.stringify(questions.map(q=>({questionItemId:q.id,question:q.question,answer:answers[q.id].answers[0].trim()})))+'\n</send_user_message_question_reply>';
}
export class QuestionDrafts {
  constructor(storage,host,onError=()=>{}){this.storage=storage;this.key='rcm.questions.'+host;this.onError=onError;try{const saved=JSON.parse(storage.getItem(this.key)||'{}');this.values=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{this.values={};}}
  keyFor(r){return JSON.stringify([r.threadId,r.key??r.id,r.kind==='asyncQuestion'?[r.params.turnId,r.params.itemId]:r.params]);}
  get(r){return this.values[this.keyFor(r)]||{};}
  set(r,patch){this.values[this.keyFor(r)]={...this.get(r),...patch};this.save();}
  clear(r){delete this.values[this.keyFor(r)];this.save();}
  save(){try{this.storage.setItem(this.key,JSON.stringify(this.values));}catch{this.onError();}}
}

// Ephemeral display state derived only from native questions and accepted replies.
export class PendingQuestions {
  entries=new Map();answered=new Set();finished=new Set();
  clear(){this.entries.clear();this.answered.clear();this.finished.clear();}
  remember(set,key){set.add(key);if(set.size>10000)set.delete(set.values().next().value);}
  update(method,p) {
    const before=new Map(this.entries),id=p.threadId||p.thread?.id;
    if(method==='turn/completed')this.remember(this.finished,JSON.stringify([id,p.turn?.id]));
    if(method==='thread/closed'||method==='turn/completed')for(const [key,r] of this.entries)if(r.threadId===id&&(method==='thread/closed'||r.params.turnId===p.turn?.id))this.entries.delete(key);
    if(['item/started','item/completed'].includes(method)&&id&&p.turnId&&p.item){
      for(const reply of questionReplies(p.item))this.remember(this.answered,JSON.stringify([id,reply.questionItemId]));
      for(const reply of questionReplies(p.item))for(const [key,r] of this.entries)if(r.threadId===id){
        const questions=r.params.questions.filter(q=>q.id!==reply.questionItemId);
        if(questions.length)this.entries.set(key,{...r,params:{...r.params,questions}});else this.entries.delete(key);
      }
      for(const r of this.finished.has(JSON.stringify([id,p.turnId]))?[]:asyncQuestions([{id:p.turnId,status:'inProgress',items:[p.item]}],id)){
        r.params.questions=r.params.questions.filter(q=>!this.answered.has(JSON.stringify([id,q.id])));
        if(r.params.questions.length)this.entries.set(r.key,r);
      }
    }
    return {added:[...this.entries.values()].filter(r=>JSON.stringify(before.get(r.key))!==JSON.stringify(r)),removed:[...before.values()].filter(r=>!this.entries.has(r.key)),changed:JSON.stringify([...before])!==JSON.stringify([...this.entries])};
  }
}
