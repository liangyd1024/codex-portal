import type {publishSendActions} from '../components/SendActions';
interface Options {
 active:boolean;ready:boolean;own:boolean;posting:boolean;handing:boolean;stopping:boolean;
 loginRecovery:boolean;desktopMode:boolean;interrupting:boolean;archived:boolean;touch:boolean;
 backgroundState:string;followUp:string;attachmentPending?:boolean;hasAttachments?:boolean;hasAnnotations?:boolean;
 text:string;hasModel:boolean;hasEffort:boolean;featureReady:(feature:string)=>boolean;
}
export function composerSendView({active,ready,own,posting,handing,stopping,loginRecovery,desktopMode,interrupting,archived,touch,backgroundState,followUp,attachmentPending,hasAttachments,hasAnnotations,text,hasModel,hasEffort,featureReady}:Options){
  const buttonView:Parameters<typeof publishSendActions>[0]={send:{disabled:false,label:''},guide:{hidden:false,disabled:false},stop:{hidden:false,disabled:false,text:'',title:''}};
  buttonView.send.disabled = loginRecovery || !ready || !own || !featureReady(active?(followUp==='queue'?'queueWrite':'steer'):'message') || posting || attachmentPending || (!text.trim()&&!hasAttachments&&!hasAnnotations) || (!active && (!hasModel || !hasEffort));
  buttonView.send.label=active ? (followUp==='queue'?'排队发送':'引导当前任务') : '发送消息';
  buttonView.guide.hidden=!active||touch||desktopMode;buttonView.guide.disabled=!ready||!own||posting||attachmentPending||!featureReady('steer')||(!text.trim()&&!hasAttachments&&!hasAnnotations);
  buttonView.send.title = posting ? '正在发送…' : active ? (followUp==='queue'?'排队发送':'引导当前任务') : '发送消息';
  buttonView.stop.hidden = !active&&backgroundState!=='running'&&!stopping; buttonView.stop.disabled = !ready || !own || !featureReady('stop') || interrupting || stopping;
  const unavailable = !ready ? '连接恢复后可继续，草稿已保留。' : archived ? '此会话已归档，恢复后可继续。' : handing ? '正在确认交还状态，草稿已保留。' : posting ? '' : !featureReady(active?(followUp==='queue'?'queueWrite':'steer'):'message') ? '当前引擎暂不支持此操作。' : active && !featureReady('stop') ? '当前引擎暂不支持停止，仍可补充要求。' : own && !active && !hasModel ? '请选择一个可用模型。' : own && !active && !hasEffort ? '请选择思考档位。' : '';
 return {buttonView,unavailable};
}
