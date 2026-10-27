import type {NativeHandoff} from '../../contracts/native';
export interface HandoffState {id?:string|null;context?:string|null;owned?:boolean;handoff?:NativeHandoff|null;connected?:boolean;supported?:boolean;busy?:boolean;archived?:boolean;conflict?:boolean;running?:boolean}
export interface HandoffView {buttonHidden:boolean;buttonDisabled:boolean;buttonText:string;buttonTitle:string;bannerHidden:boolean;message:string;retryHidden:boolean;retryDisabled:boolean;closeHidden:boolean;error:boolean;busy:boolean}
interface Options {endUse:()=>unknown;publish:(view:HandoffView)=>void;focus:(banner:boolean)=>void;restoreFocus:()=>void}
export function handoffMessage(handoff:NativeHandoff|null|undefined,connected:boolean|undefined) {
  if(!handoff)return '';
  if(handoff.state==='checking')return '正在检查此会话能否交还…';
  if(handoff.state==='released')return '已结束网页使用。请在桌面打开此会话（如有提示可点“重试”），网页会自动识别可用入口。草稿保留在此网页。';
  if(!connected)return '交还状态待确认。恢复连接后会继续检查，网页不会自动接管此会话。';
  if(handoff.state==='waiting'){
    const delay=handoff.unloadDelaySecs;
    const timing=Number.isFinite(delay)?`本引擎设为无订阅、无活动 ${delay} 秒后释放`:'释放时间取决于引擎设置，默认约 30 分钟';
    return '网页已退出此会话，正在等待引擎释放。'+timing+'；其他入口仍使用此会话时会继续等待。';
  }
  return '交还结果尚未确认。网页不会自动接管；请重试交还或明确选择在网页继续。';
}

export function createHandoffController({endUse,publish,focus,restoreFocus}:Options){
 let current:HandoffState={},notice:{kind:string;text:string}|null=null,bannerHidden=true;
 const controls={
  focus(){focus(!bannerHidden);},
  showError(text:string){notice={kind:'error',text};controls.render(current);},
  run(){if(current.running){notice={kind:'running',text:'当前任务正在运行，请在任务结束后再交还桌面端。你可以继续补充要求。'};controls.render(current);return;}notice=null;void endUse();},
  dismiss(){notice=null;controls.render(current);restoreFocus();},
  render({id,context=id,owned,handoff,connected,supported,busy,archived,conflict,running=false}:HandoffState){
   if(id!==current.id||context!==current.context||notice?.kind==='running'&&!running)notice=null;
   current={id,context,owned,handoff,connected,supported,busy,archived,conflict,running};
   bannerHidden=!id||(!notice&&!handoff);
   publish({buttonHidden:Boolean(!id||archived||(!owned&&!['unknown','checking'].includes(handoff?.state!))),
    buttonDisabled:Boolean(!connected||!supported||busy||handoff?.state==='checking'||(!owned&&handoff?.state!=='unknown')),
    buttonText:busy||handoff?.state==='checking'?'正在检查…':handoff?.state==='unknown'?'重试交还':'交还桌面端',
    buttonTitle:!supported?'当前引擎尚未核验交还能力，请重连后检查。':'只结束此会话的网页使用，其他会话继续运行。',
    bannerHidden,message:notice?.text||handoffMessage(handoff,connected),retryHidden:notice?.kind!=='error'&&handoff?.state!=='unknown',retryDisabled:Boolean(!connected||busy||running),closeHidden:!notice,error:notice?.kind==='error',busy:Boolean(busy||handoff?.state==='checking')});
  }
 };
 return controls;
}
let install:((options:Pick<Options,'endUse'>)=>ReturnType<typeof createHandoffController>)|undefined;
export function configureHandoffView(value:NonNullable<typeof install>){install=value;}
export function createHandoffControls(options:Pick<Options,'endUse'>){if(!install)throw Error('交还视图未安装。');return install(options);}
