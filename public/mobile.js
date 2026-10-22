import {copyText} from './feedback.js';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
function setting(title,id,key,options){
 const label=node('label',title,'mobile-field'),select=node('select');select.id=id;
 for(const [value,text] of options){const o=node('option',text);o.value=value;select.append(o);}
 try{const saved=localStorage.getItem(key);if(options.some(([v])=>v===saved))select.value=saved;}catch{}
 select.onchange=()=>{try{localStorage.setItem(key,select.value);}catch{}};label.append(select);return {label,select};
}
let mobileLoadVersion=0;
export async function installMobile(api){
 const version=++mobileLoadVersion;
 const body=document.getElementById('mobile-access-body');body.replaceChildren();
 body.append(node('p','正在检查手机访问…','subtle'));
 let info;try{info=await api('/api/access/status');}catch(error){if(version!==mobileLoadVersion)return;body.replaceChildren(node('p','无法检查手机访问：'+error.message));const retry=node('button','重试','secondary-button');retry.onclick=()=>installMobile(api);body.append(retry);return;}
 if(version!==mobileLoadVersion)return;
 body.replaceChildren();
 if(!info.local){body.append(node('p',info.sessionExpires===null?'当前手机：永久登录。':'登录有效期至 '+new Date(info.sessionExpires).toLocaleString('zh-CN')));const button=node('button','退出手机登录','secondary-button');button.onclick=async()=>{if(button.disabled)return;button.disabled=true;button.textContent='正在退出…';try{await api('/api/access/logout',{method:'POST'});location.reload();}catch(e){body.append(node('p',e.message));button.textContent='重试退出登录';button.disabled=false;}};body.append(button);return;}
 body.append(node('h3','1. 选择手机访问地址'));
 for(const origin of info.origins){
  const tail=origin.includes('.ts.net'),card=node('details',null,'mobile-address');card.open=info.origins.length===1;
  card.append(node('summary',tail?'Tailscale · 已连接 Tailscale 的手机':'同一 Wi-Fi · 需安装证书'));
  const link=node('a',origin);link.href=origin;const qr=node('img');qr.src='/api/access/qr?kind='+(tail?'tailscale':'lan');qr.alt='手机访问地址二维码';qr.width=160;qr.height=160;
  const button=node('button','复制地址','secondary-button');const copied=node('span','','subtle');copied.setAttribute('role','status');button.onclick=()=>copyText(origin,{button,status:copied});card.append(link,qr,button,copied);if(tail)card.append(node('p',info.tailscaleStatus||'HTTPS 转发已配置，请用已连接 Tailscale 的手机验证。','subtle'));
  if(!tail){const help=node('p','在 Mac 下载证书，通过 AirDrop 或文件传输发送到手机并安装。iPhone：安装描述文件后，在“设置 → 通用 → 关于本机 → 证书信任设置”中启用信任。安卓：在安全设置中安装 CA 证书。');const ca=node('a','下载局域网证书');ca.href='/api/access/ca';ca.download='Codex-Local-CA.crt';card.append(help,ca);}
  body.append(card);
 }
 if(!info.origins.length){
  const empty=node('div',null,'mobile-setup');
  empty.append(node('strong','尚未开启手机访问'),node('p','先在这台 Mac 开启安全连接，再用同一 Wi-Fi 下的手机扫码配对。'));
  const status=node('p','','subtle');status.setAttribute('role','status');
  if(info.canSetup){
   const setup=node('button','开启同一 Wi-Fi 访问','primary-button full-width');
   setup.onclick=async()=>{setup.disabled=true;setup.textContent='正在配置…';status.textContent='正在创建证书并启动手机入口，请稍候。';try{await api('/api/access/setup',{timeout:120000,method:'POST',body:{}});await installMobile(api);}catch(e){status.textContent='配置未完成：'+e.message;setup.textContent='重试配置';setup.disabled=false;}};
   empty.append(setup,node('p','开启后需在手机安装并信任本机证书。Mac 需保持开机且连接网络。','subtle'));
  }else empty.append(node('p','请在这台 Mac 的正式工作台开启手机访问；开发预览不开放手机入口。','subtle'));
  const refresh=node('button','重新检查','secondary-button');refresh.onclick=()=>installMobile(api);empty.append(refresh,status);body.append(empty);
 }
 if(info.canSetup&&!info.origins.some(origin=>new URL(origin).hostname.endsWith('.ts.net'))){
  const tail=node('details',null,'mobile-address');tail.append(node('summary','Tailscale · 跨网络访问'),node('p','Mac 和手机需登录同一 Tailscale 网络。开启后可跨网络扫码配对，无需安装局域网证书。'));
  const setup=node('button','开启 Tailscale 访问','secondary-button full-width'),status=node('p','','subtle');status.setAttribute('role','status');
  setup.onclick=async()=>{setup.disabled=true;setup.textContent='正在配置…';status.textContent='正在检查 Tailscale 和 HTTPS 转发…';try{await api('/api/access/setup',{timeout:120000,method:'POST',body:{mode:'tailscale'}});await installMobile(api);}catch(e){status.textContent='配置未完成：'+e.message;setup.textContent='重试 Tailscale 配置';setup.disabled=false;}};
  tail.append(setup,status);body.append(tail);
 }
 if(info.origins.length){const refresh=node('button','重新检查连接','secondary-button');refresh.onclick=()=>installMobile(api);body.append(refresh);}
 body.append(node('h3','2. 设置有效期'));
 const expiry=setting('配对码有效期','pair-code-expiry','rcm.pairCodeExpiry',[['3600','1 小时（默认）'],['600','10 分钟'],['86400','24 小时'],['604800','7 天'],['permanent','永不过期']]);
 const session=setting('配对后的手机登录有效期','mobile-session-expiry','rcm.mobileSessionExpiry',[['604800','7 天（默认）'],['86400','1 天'],['2592000','30 天'],['permanent','永久登录']]);
 body.append(expiry.label,session.label,node('p','配对一次后，同一手机浏览器在登录有效期内可直接访问；重启或升级工作台不需要重新配对。设置只影响新配对的设备。登录过期、退出、撤销或清除网站数据后需要重新配对。','subtle'),node('h3','3. 生成配对码'));
 const result=node('div',null,'pair-result');result.setAttribute('role','status');result.hidden=true;
 const generate=node('button','生成配对码','primary-button full-width');generate.disabled=!info.origins.length;
 if(!info.origins.length){expiry.select.disabled=true;session.select.disabled=true;generate.setAttribute('aria-describedby','mobile-setup-required');}
 const value=s=>s.value==='permanent'?null:Number(s.value);
 generate.onclick=async()=>{if(generate.disabled)return;generate.disabled=true;generate.textContent='正在生成…';revokeStatus.textContent='';try{const d=await api('/api/access/code',{method:'POST',body:{ttlSeconds:value(expiry.select),sessionTtlSeconds:value(session.select)}});result.replaceChildren();const code=node('strong',d.code,'pair-code');const copyButton=node('button','复制配对码','secondary-button');const copied=node('span','','subtle');copied.setAttribute('role','status');copyButton.onclick=()=>copyText(d.code,{button:copyButton,status:copied});result.append(code,copyButton,copied,node('p',(d.expires===null?'配对码永不过期':'配对码到期：'+new Date(d.expires).toLocaleString('zh-CN'))+'。仅可使用一次。'),node('p',d.sessionTtlSeconds===null?'配对后永久登录。':'配对后登录有效期：'+d.sessionTtlSeconds/86400+' 天。'));generate.textContent='重新生成配对码';}catch(e){result.textContent=e.message;generate.textContent='重试生成配对码';}finally{result.hidden=false;generate.disabled=false;}};
 const hint=node('p',info.origins.length?'生成新码会使旧码失效。':'先开启手机访问，再设置有效期并生成配对码。','subtle');hint.id='mobile-setup-required';body.append(generate,result,hint);
 const revokeStatus=node('p','','subtle');revokeStatus.setAttribute('role','status');
 const danger=node('details',null,'mobile-revoke');danger.append(node('summary','撤销手机访问'));
 danger.append(node('p','全部手机将退出登录，当前配对码也会失效。'));
 const revoke=node('button','撤销全部手机登录','secondary-button full-width');revoke.onclick=async()=>{if(revoke.disabled)return;revoke.disabled=true;revoke.textContent='正在撤销…';revokeStatus.textContent='';try{await api('/api/access/revoke',{method:'POST',body:{}});result.hidden=true;generate.textContent='生成配对码';revokeStatus.textContent='已撤销全部手机登录和当前配对码。';}catch(e){revokeStatus.textContent=e.message;}finally{revoke.disabled=false;revoke.textContent='撤销全部手机登录';}};danger.append(revoke,revokeStatus);body.append(danger);
}
