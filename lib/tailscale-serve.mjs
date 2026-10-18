export function checkServe(config,dns){
 const key=dns+':443',web=config.Web?.[key],tcp=config.TCP?.['443'];
 if(config.AllowFunnel?.[key])throw Error('此 Tailscale 地址已开启公网 Funnel，请先关闭该入口的 Funnel 后再配置。');
 const handlers=web?.Handlers||{};
 if(Object.keys(handlers).some(p=>p!=='/')||handlers['/']&&handlers['/'].Proxy!=='http://127.0.0.1:4318'||tcp&&!tcp.HTTPS)throw Error('Tailscale 的 443 端口已有其他服务，请先调整现有服务，避免覆盖。');
 return Boolean(tcp?.HTTPS&&handlers['/']?.Proxy==='http://127.0.0.1:4318');
}
