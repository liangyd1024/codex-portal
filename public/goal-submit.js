// Only submission intent/uncertain receipts live here; the native goal stays authoritative.
export function validateGoalDraft(selection,text,active=false) {
  if(!selection.goalPending)return;
  if(active)throw Error('请等待当前轮次结束后设置目标。');
  if(!text.trim())throw Error('请在输入框中填写目标，图片可作为附件。');
  if(text.trim().length>10000)throw Error('目标不能超过 10000 个字符，请缩短输入内容。');
}
export async function prepareGoalSubmission({selection,text,id,active,api,save}) {
  validateGoalDraft(selection,text,active);
  if(!selection.goalPending)return false;
  const objective=text.trim(),route='/api/threads/'+encodeURIComponent(id);
  if(selection.goalUncertain){
    const detail=await api(route);
    if(detail.goalError||detail.goal?.objective!==selection.goalUncertain||!['active','paused','complete'].includes(detail.goal?.status))throw Error('上次目标设置结果仍未确认，请核对会话目标后重新选择“目标”。草稿已保留。');
    selection.goalPending=false;delete selection.goalUncertain;save();return true;
  }
  // Persist before the request: a reload/disconnect must not blindly repeat a write.
  selection.goalUncertain=objective;save();
  try {
    await api(route+'/goal',{method:'POST',body:{objective,status:'active'}});
    selection.goalPending=false;delete selection.goalUncertain;save();return true;
  } catch(error) {
    if(error.status>=400&&error.status<500&&error.code!=='OUTCOME_UNKNOWN'){delete selection.goalUncertain;save();}
    throw error;
  }
}

export async function sendAfterGoal({goalStarted,id,payload,active,api}) {
  // A native active goal starts its own turn; text-only goals need no second send.
  if(goalStarted&&!payload.images?.length)return {};
  const route='/api/threads/'+encodeURIComponent(id);
  let steering=active;
  if(goalStarted){const detail=await api(route);steering=detail.thread?.status?.type==='active';}
  return api(route+(steering?'/steer':'/message'),{method:'POST',body:steering?{text:payload.text,images:payload.images,...(payload.skills?{skills:payload.skills}:{}),...(payload.plugins?{plugins:payload.plugins}:{})}:payload});
}
