export function checkServe(config,dns){
 const key=dns+':443',web=config.Web?.[key],tcp=config.TCP?.['443'];
 if(config.AllowFunnel?.[key])throw Error('此 Tailscale 地址已开启公网 Funnel，请先关闭该入口的 Funnel 后再配置。');
 const handlers=web?.Handlers||{};
 if(Object.keys(handlers).some(p=>p!=='/')||handlers['/']&&handlers['/'].Proxy!=='http://127.0.0.1:4318'||tcp&&!tcp.HTTPS)throw Error('Tailscale 的 443 端口已有其他服务，请先调整现有服务，避免覆盖。');
 return Boolean(tcp?.HTTPS&&handlers['/']?.Proxy==='http://127.0.0.1:4318');
}

export function describeTailscale(status){
 if(status.BackendState!=='Running')return 'Tailscale 未连接，请在 Mac 打开并登录后重新检查。';
 if(status.Health?.length)return 'Tailscale 暂未就绪：'+status.Health.join('；');
 return 'HTTPS 转发已配置。请用已连接同一 Tailscale 网络的手机打开地址验证。';
}
export async function tailscaleHealth(){
 try{
  const {existsSync}=await import('node:fs'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const binary=['/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale','/Applications/Tailscale.app/Contents/MacOS/Tailscale'].find(existsSync);
  if(!binary)return '未找到 Tailscale，请检查 Mac 上的安装。';
  const {stdout}=await promisify(execFile)(binary,['status','--json'],{timeout:3000});
  return describeTailscale(JSON.parse(stdout));
 }catch{return '暂时无法检查 Tailscale 状态，请确认它已启动后重试。';}
}
