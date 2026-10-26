export interface BannerView {hidden:boolean;className:string;text:string}
const featureNames:Record<string,string>={create:'新建会话',takeover:'接管会话',message:'发送消息',steer:'补充要求',stop:'停止',queue:'排队输入',queueEdit:'编辑排队输入',queueWrite:'提交排队输入',handoff:'交还桌面端',release:'释放控制',sideChat:'侧聊',threadReferences:'会话引用',threadReferenceSteer:'执行中补充会话引用',projectFolders:'项目目录',capacityRetry:'限流重试',plan:'计划模式',skills:'技能',plugins:'插件',goal:'目标管理',goalClear:'清除目标'};
const primaryFeatures=new Set(['create','takeover','message','steer','stop','queue','queueEdit','queueWrite','handoff','release']);
export function protocolDiagnostics(validation:{features?:Record<string,{supported?:boolean;reason?:string}>;methodReasons?:Record<string,string>}){
 const features=Object.entries(validation.features||{}).filter(([,value])=>value.supported===false);
 const reasons=features.map(([name,value])=>(featureNames[name]||'扩展功能')+'：'+(value.reason||'当前引擎未提供兼容接口。'));
 for(const reason of Object.values(validation.methodReasons||{}))if(!features.some(([,value])=>value.reason?.includes(reason)))reasons.push(reason);
 return reasons;
}
interface Context {
 recovering?:boolean;transport:boolean;error:string;connection:string;stage?:string;stageLabel?:string;
 connected:boolean;desktopMode:boolean;loginRecovery?:string;limited:boolean;
 features?:Record<string,{supported?:boolean}>;recoveryMessage:()=>string;
}
export function connectionBanner(context:Context):Partial<BannerView>{
 const show=(text:string,error=false):BannerView=>({hidden:false,className:'connection-banner'+(error?' error':''),text});
 if(!context.transport&&context.recovering)return show('正在恢复连接并同步消息…');
 if(!context.transport)return show('与网页服务的连接已中断，正在自动重连。已有内容和草稿保留，恢复后将自动同步。');
 if(context.error)return show(context.error,true);
 if(['connecting','reconnecting'].includes(context.connection))return show('正在连接目标机器。'+(context.stage?(context.stageLabel||context.stage)+'…':'正在核验连接状态…'));
 if(context.connected&&context.loginRecovery&&!context.desktopMode)return show(context.loginRecovery,true);
 if(context.connected&&context.limited){
  const disabled=Object.entries(context.features||{}).filter(([name,value])=>primaryFeatures.has(name)&&value.supported===false).map(([name])=>featureNames[name]);
  if(disabled.length||!Object.keys(context.features||{}).length)return show('已连接。当前引擎暂不支持：'+(disabled.join('、')||'部分协议读取')+'。其他已核验功能仍可使用。详见连接诊断。');
 }
 if(context.connected){const message=context.recoveryMessage();if(message)return show(message);}
 return {hidden:true};
}
