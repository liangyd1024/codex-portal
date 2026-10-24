import {Component,Fragment,useEffect,useRef,useState,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';

type Api=(path:string,options?:{method:'POST';body?:Record<string,unknown>;timeout?:number})=>Promise<unknown>;
interface Info {local:boolean;sessionExpires:number|null;origins:string[];canSetup:boolean;tailscaleStatus?:string}
interface Code {code:string;expires:number|null;sessionTtlSeconds:number|null}
interface Load {version:number;phase:'idle'|'loading'|'error'|'ready'|'fatal';api:Api|null;info:Info|null;error:string}
const store=createStore<Load>(()=>({version:0,phase:'idle',api:null,info:null,error:''}));
const message=(error:unknown)=>(error as Error).message;
export function showMobileError(error:unknown){flushSync(()=>store.setState({phase:'fatal',error:message(error)}));}
export async function installMobile(api:Api) {
 const version=store.getState().version+1;
 flushSync(()=>store.setState({version,phase:'loading',api,info:null,error:''}));
 try{const info=await api('/api/access/status') as Info;if(store.getState().version!==version)return;flushSync(()=>store.setState({phase:'ready',info}));}
 catch(error){if(store.getState().version!==version)return;flushSync(()=>store.setState({phase:'error',error:message(error)}));}
}
function Copy({text,label}:{text:string;label:string}) {
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),pending=useRef(false);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const copy=async()=>{
  if(pending.current)return;pending.current=true;clearTimeout(timer.current);setBusy(true);setStatus('正在复制…');
  try{await navigator.clipboard.writeText(text);setStatus('已复制');timer.current=setTimeout(()=>setStatus(value=>value==='已复制'?'':value),2000);}
  catch{setStatus('无法自动复制。请选中文字后复制。');}
  finally{pending.current=false;setBusy(false);}
 };
 return <><button className="secondary-button" disabled={busy} onClick={()=>void copy()}>{label}</button><span className="subtle" role="status">{status}</span></>;
}
const codeOptions=[['3600','1 小时（默认）'],['600','10 分钟'],['86400','24 小时'],['604800','7 天'],['permanent','永不过期']];
const sessionOptions=[['604800','7 天（默认）'],['86400','1 天'],['2592000','30 天'],['permanent','永久登录']];
function preference(key:string,options:string[][]){try{const saved=localStorage.getItem(key);if(options.some(([v])=>v===saved))return saved!;}catch{}return options[0][0];}
function savePreference(key:string,value:string){try{localStorage.setItem(key,value);}catch{}}
function Setting({title,id,options,value,onChange,disabled}:{title:string;id:string;options:string[][];value:string;onChange:(value:string)=>void;disabled:boolean}) {
 return <label className="mobile-field">{title}<select id={id} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{options.map(([v,text])=><option key={v} value={v}>{text}</option>)}</select></label>;
}
function Setup({api,tail=false}:{api:Api;tail?:boolean}) {
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[status,setStatus]=useState('');
 const setup=async()=>{
  setBusy(true);setStatus(tail?'正在检查 Tailscale 和 HTTPS 转发…':'正在创建证书并启动手机入口，请稍候。');
  try{await api('/api/access/setup',{timeout:120000,method:'POST',body:tail?{mode:'tailscale'}:{}});await installMobile(api);}
  catch(error){setStatus('配置未完成：'+message(error));setFailed(true);setBusy(false);}
 };
 const button=<button className={tail?'secondary-button full-width':'primary-button full-width'} disabled={busy} onClick={()=>void setup()}>{busy?'正在配置…':failed?(tail?'重试 Tailscale 配置':'重试配置'):(tail?'开启 Tailscale 访问':'开启同一 Wi-Fi 访问')}</button>;
 if(tail)return <details className="mobile-address"><summary>Tailscale · 跨网络访问</summary><p>Mac 和手机需登录同一 Tailscale 网络。开启后可跨网络扫码配对，无需安装局域网证书。</p>{button}<p className="subtle" role="status">{status}</p></details>;
 return <>{button}<p className="subtle">开启后需在手机安装并信任本机证书。Mac 需保持开机且连接网络。</p><button className="secondary-button" onClick={()=>void installMobile(api)}>重新检查</button><p className="subtle" role="status">{status}</p></>;
}
function Phone({api,info}:{api:Api;info:Info}) {
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[errors,setErrors]=useState<string[]>([]),pending=useRef(false);
 const logout=async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);
  try{await api('/api/access/logout',{method:'POST'});location.reload();}
  catch(error){setErrors(values=>[...values,message(error)]);setFailed(true);setBusy(false);pending.current=false;}
 };
 return <><p>{info.sessionExpires===null?'当前手机：永久登录。':'登录有效期至 '+new Date(info.sessionExpires).toLocaleString('zh-CN')}</p><button className="secondary-button" disabled={busy} onClick={()=>void logout()}>{busy?'正在退出…':failed?'重试退出登录':'退出手机登录'}</button>{errors.map((text,i)=><p key={i}>{text}</p>)}</>;
}
function Local({api,info}:{api:Api;info:Info}) {
 const [expiry,setExpiry]=useState(()=>preference('rcm.pairCodeExpiry',codeOptions));
 const [session,setSession]=useState(()=>preference('rcm.mobileSessionExpiry',sessionOptions));
 const [generating,setGenerating]=useState(false),[generateLabel,setGenerateLabel]=useState('生成配对码');
 const [result,setResult]=useState<Code|string|null>(null),[visible,setVisible]=useState(false),[codeVersion,setCodeVersion]=useState(0);
 const [revoking,setRevoking]=useState(false),[revokeStatus,setRevokeStatus]=useState('');
 const busy=useRef({generate:false,revoke:false});
 const generate=async()=>{
  if(busy.current.generate||!info.origins.length)return;busy.current.generate=true;setGenerating(true);setGenerateLabel('正在生成…');setRevokeStatus('');
  const value=(s:string)=>s==='permanent'?null:Number(s);
  try{const data=await api('/api/access/code',{method:'POST',body:{ttlSeconds:value(expiry),sessionTtlSeconds:value(session)}}) as Code;setResult(data);setCodeVersion(v=>v+1);setGenerateLabel('重新生成配对码');}
  catch(error){setResult(message(error));setGenerateLabel('重试生成配对码');}
  finally{setVisible(true);setGenerating(false);busy.current.generate=false;}
 };
 const revoke=async()=>{
  if(busy.current.revoke)return;busy.current.revoke=true;setRevoking(true);setRevokeStatus('');
  try{await api('/api/access/revoke',{method:'POST',body:{}});setVisible(false);setGenerateLabel('生成配对码');setRevokeStatus('已撤销全部手机登录和当前配对码。');}
  catch(error){setRevokeStatus(message(error));}
  finally{busy.current.revoke=false;setRevoking(false);}
 };
 return <>
  <h3>1. 选择手机访问地址</h3>
  {info.origins.map((origin,index)=>{const tail=origin.includes('.ts.net');return <details key={index} className="mobile-address" open={info.origins.length===1}>
   <summary>{tail?'Tailscale · 已连接 Tailscale 的手机':'同一 Wi-Fi · 需安装证书'}</summary>
   <a href={origin}>{origin}</a><img src={'/api/access/qr?kind='+(tail?'tailscale':'lan')} alt="手机访问地址二维码" width={160} height={160}/><Copy text={origin} label="复制地址"/>
   {tail?<p className="subtle">{info.tailscaleStatus||'HTTPS 转发已配置，请用已连接 Tailscale 的手机验证。'}</p>:<><p>在 Mac 下载证书，通过 AirDrop 或文件传输发送到手机并安装。iPhone：安装描述文件后，在“设置 → 通用 → 关于本机 → 证书信任设置”中启用信任。安卓：在安全设置中安装 CA 证书。</p><a href="/api/access/ca" download="Codex-Local-CA.crt">下载局域网证书</a></>}
  </details>;})}
  {!info.origins.length&&<div className="mobile-setup"><strong>尚未开启手机访问</strong><p>先在这台 Mac 开启安全连接，再用同一 Wi-Fi 下的手机扫码配对。</p>{info.canSetup?<Setup api={api}/>:<><p className="subtle">请在这台 Mac 的正式工作台开启手机访问；开发预览不开放手机入口。</p><button className="secondary-button" onClick={()=>void installMobile(api)}>重新检查</button><p className="subtle" role="status"/></>}</div>}
  {info.canSetup&&!info.origins.some(origin=>new URL(origin).hostname.endsWith('.ts.net'))&&<Setup api={api} tail/>}
  {info.origins.length>0&&<button className="secondary-button" onClick={()=>void installMobile(api)}>重新检查连接</button>}
  <h3>2. 设置有效期</h3>
  <Setting title="配对码有效期" id="pair-code-expiry" options={codeOptions} value={expiry} disabled={!info.origins.length} onChange={value=>{setExpiry(value);savePreference('rcm.pairCodeExpiry',value);}}/>
  <Setting title="配对后的手机登录有效期" id="mobile-session-expiry" options={sessionOptions} value={session} disabled={!info.origins.length} onChange={value=>{setSession(value);savePreference('rcm.mobileSessionExpiry',value);}}/>
  <p className="subtle">配对一次后，同一手机浏览器在登录有效期内可直接访问；重启或升级工作台不需要重新配对。设置只影响新配对的设备。登录过期、退出、撤销或清除网站数据后需要重新配对。</p><h3>3. 生成配对码</h3>
  <button className="primary-button full-width" disabled={generating||!info.origins.length} aria-describedby={!info.origins.length?'mobile-setup-required':undefined} onClick={()=>void generate()}>{generateLabel}</button>
  <div className="pair-result" role="status" hidden={!visible}>{typeof result==='string'?result:result&&<Fragment key={codeVersion}><strong className="pair-code">{result.code}</strong><Copy text={result.code} label="复制配对码"/><p>{(result.expires===null?'配对码永不过期':'配对码到期：'+new Date(result.expires).toLocaleString('zh-CN'))+'。仅可使用一次。'}</p><p>{result.sessionTtlSeconds===null?'配对后永久登录。':'配对后登录有效期：'+result.sessionTtlSeconds/86400+' 天。'}</p></Fragment>}</div>
  <p className="subtle" id="mobile-setup-required">{info.origins.length?'生成新码会使旧码失效。':'先开启手机访问，再设置有效期并生成配对码。'}</p>
  <details className="mobile-revoke"><summary>撤销手机访问</summary><p>全部手机将退出登录，当前配对码也会失效。</p><button className="secondary-button full-width" disabled={revoking} onClick={()=>void revoke()}>{revoking?'正在撤销…':'撤销全部手机登录'}</button><p className="subtle" role="status">{revokeStatus}</p></details>
 </>;
}
class MobileBoundary extends Component<{children:ReactNode},{error:string|null}> {
 state:{error:string|null}={error:null};
 static getDerivedStateFromError(error:unknown){return {error:message(error)};}
 render(){return this.state.error===null?this.props.children:this.state.error;}
}
function Loaded({api,info}:{api:Api;info:Info}) {return info.local?<Local api={api} info={info}/>:<Phone api={api} info={info}/>;}
export function MobileAccessView() {
 const view=useStore(store);if(view.phase==='idle')return null;
 if(view.phase==='fatal')return view.error;
 if(view.phase==='loading')return <p className="subtle">正在检查手机访问…</p>;
 if(view.phase==='error')return <><p>{'无法检查手机访问：'+view.error}</p><button className="secondary-button" onClick={()=>void installMobile(view.api!)}>重试</button></>;
 return <MobileBoundary key={view.version}><Loaded api={view.api!} info={view.info!}/></MobileBoundary>;
}
