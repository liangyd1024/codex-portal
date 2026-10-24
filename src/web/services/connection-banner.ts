export interface BannerView {hidden:boolean;className:string;text:string}
interface Context {
 transport:boolean;error:string;connection:string;stage?:string;stageLabel?:string;
 connected:boolean;desktopMode:boolean;loginRecovery?:string;limited:boolean;
 features?:Record<string,{supported?:boolean}>;recoveryMessage:()=>string;
}
export function connectionBanner(context:Context):Partial<BannerView>{
 const show=(text:string,error=false):BannerView=>({hidden:false,className:'connection-banner'+(error?' error':''),text});
 if(!context.transport)return show('与网页服务的连接已中断，正在自动重连。已有内容和草稿保留，恢复后将自动同步。');
 if(context.error)return show(context.error,true);
 if(['connecting','reconnecting'].includes(context.connection))return show('正在连接目标机器。'+(context.stage?(context.stageLabel||context.stage)+'…':'正在核验连接状态…'));
 if(context.connected&&context.loginRecovery&&!context.desktopMode)return show(context.loginRecovery,true);
 if(context.connected&&context.limited){
  const names:Record<string,string>={create:'新建会话',takeover:'接管会话',message:'发送消息',steer:'补充要求',stop:'停止',queue:'排队输入',handoff:'交还桌面端',release:'释放控制'};
  const disabled=Object.entries(context.features||{}).filter(([,value])=>!value.supported).map(([name])=>names[name]||name);
  return show('已连接。当前引擎暂不支持：'+(disabled.join('、')||'部分协议读取')+'。其他已核验功能仍可使用。详见连接诊断。');
 }
 if(context.connected){const message=context.recoveryMessage();if(message)return show(message);}
 return {hidden:true};
}
