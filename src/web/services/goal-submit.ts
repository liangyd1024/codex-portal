import type {NativeGoal,NativeDetail,NativeTurn} from '../../contracts/native';
import type {ApiOptions,ApiError} from './api';
interface GoalSelection {goalPending?:boolean;goalUncertain?:string}
interface GoalContext {goal?:NativeGoal|null;goalError?:unknown}
interface GoalResult {goalOnly?:boolean;turn?:NativeTurn;queuedSubmission?:{id:string;[field:string]:unknown};[field:string]:unknown}
type Api=<T=GoalResult>(path:string,options?:ApiOptions)=>Promise<T>;
interface Preparation extends GoalContext {selection:GoalSelection;text:string;id:string;active:boolean;api:Api;save:()=>void}
interface Submission {goalStarted:boolean;id:string;payload:{text:string;images?:{url:string}[];skills?:unknown;plugins?:unknown;[field:string]:unknown};active:boolean;api:Api}
// Only submission intent/uncertain receipts live here; the native goal stays authoritative.
export function reconcileGoalSelection(selection:GoalSelection,{goal,goalError}:GoalContext={},save:()=>void=()=>{}) {
  if(!selection.goalPending||selection.goalUncertain||goalError||!goal)return;
  selection.goalPending=false;save();
}

export function validateGoalDraft(selection:GoalSelection,text:string,active=false,goal:NativeGoal|null=null) {
  if(active||goal||!selection.goalPending)return;
  if(!text.trim())throw Error('请在输入框中填写目标，图片可作为附件。');
  if(text.trim().length>10000)throw Error('目标不能超过 10000 个字符，请缩短输入内容。');
}
export async function prepareGoalSubmission({selection,text,id,active,goal,api,save}:Preparation) {
  // A running turn accepts follow-up input, never a new goal from the composer.
  // Leave uncertain goal receipts intact; steering is not proof of goal creation.
  if(active||goal)return false;
  validateGoalDraft(selection,text);
  if(!selection.goalPending)return false;
  const objective=text.trim(),route='/api/threads/'+encodeURIComponent(id);
  if(selection.goalUncertain){
    const detail=await api<NativeDetail>(route);
    if(detail.goalError||detail.goal?.objective!==selection.goalUncertain||!['active','paused','complete'].includes(detail.goal?.status!))throw Error('上次目标设置结果仍未确认，请核对会话目标后重新选择“目标”。草稿已保留。');
    selection.goalPending=false;delete selection.goalUncertain;save();return true;
  }
  // Persist before the request: a reload/disconnect must not blindly repeat a write.
  selection.goalUncertain=objective;save();
  try {
    await api(route+'/goal',{method:'POST',body:{objective,status:'active'}});
    selection.goalPending=false;delete selection.goalUncertain;save();return true;
  } catch(caught) {
    const error=caught as ApiError;
    if(error.status!>=400&&error.status!<500&&error.code!=='OUTCOME_UNKNOWN'){delete selection.goalUncertain;save();}
    throw error;
  }
}

export async function sendAfterGoal({goalStarted,id,payload,active,api}:Submission):Promise<GoalResult> {
  // A native active goal starts its own turn; text-only goals need no second send.
  if(goalStarted&&!payload.images?.length)return {goalOnly:true};
  const route='/api/threads/'+encodeURIComponent(id);
  let steering=active;
  if(goalStarted){const detail=await api<NativeDetail>(route);steering=(detail.thread?.status as {type?:string}|undefined)?.type==='active';}
  return api(route+(steering?'/steer':'/message'),{method:'POST',body:steering?{text:payload.text,images:payload.images,...(payload.resumeBlockedGoal?{resumeBlockedGoal:payload.resumeBlockedGoal}:{}),...(payload.skills?{skills:payload.skills}:{}),...(payload.plugins?{plugins:payload.plugins}:{}),...(payload.apps?{apps:payload.apps}:{}),...(payload.threads?{threads:payload.threads}:{})}:payload});
}
