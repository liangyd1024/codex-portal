import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {supportDir} from './config.mjs';
import {MobileAccess} from './mobile-access.mjs';
import {AppError} from './manager.mjs';

// Formal web listeners only. Native sessions and engines are never stopped.
export async function startWeb({createApp,root:ROOT}) {
  const configPath=path.join(supportDir,'mobile/config.json');
  let mobileConfig=null;try{if(process.env.RCM_MOBILE!=='0')mobileConfig=JSON.parse(await readFile(configPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const access=new MobileAccess(path.join(supportDir,'mobile/sessions.json'));
  let setupPending;
  const setupMobile=process.env.RCM_MOBILE==='0'?null:(mode='lan')=>{if(setupPending)throw new AppError('手机入口正在配置，请稍后重新检查。',409);return setupPending=(async()=>{
    await promisify(execFile)(process.execPath,[path.join(ROOT,'scripts/setup-mobile.mjs'),...(mode==='tailscale'?['--tailscale']:[])],{timeout:90000});
    const next=JSON.parse(await readFile(configPath,'utf8'));
    if(!mobileConfig){await startMobile(next);mobileConfig=next;}else{mobileConfig.origins=next.origins;}
    return mobileConfig;
  })().finally(()=>{setupPending=null;});};
  const {server,manager,managers,proxyServer,createSecureServer,setMobileConfig,ready}=await createApp({mobileConfig:null,access,setupMobile});
  async function startMobile(initial){
    const mobileConfig=initial;
    const tls=createSecureServer({key:await readFile(mobileConfig.key),cert:await readFile(mobileConfig.cert)});
    await ready();
    const listen=(endpoint,port,host)=>new Promise((resolve,reject)=>{endpoint.once('error',reject);endpoint.listen(port,host,()=>{endpoint.off('error',reject);resolve();});});
    try{await listen(proxyServer,4318,'127.0.0.1');await listen(tls,4319,mobileConfig.lanIP);}catch(error){if(proxyServer.listening)await new Promise(resolve=>proxyServer.close(resolve));throw error;}
    for(const endpoint of [proxyServer,tls])endpoint.on('error',error=>console.error('手机入口：'+error.message));
    let renewing=false,lastRenewal=Date.now();
    const refreshTLS=async()=>{
      if(renewing)return;
      const ips=Object.values(networkInterfaces()).flat().filter(Boolean).filter(n=>n.family==='IPv4'&&!n.internal).map(n=>n.address);
      if(!ips.length||tls.listening&&ips.includes(mobileConfig.lanIP)&&Date.now()-lastRenewal<86400000)return;
      renewing=true;
      try{
        await promisify(execFile)(process.execPath,[path.join(ROOT,'scripts/setup-mobile.mjs')],{timeout:90000});
        const next=JSON.parse(await readFile(configPath,'utf8'));
        const credentials={key:await readFile(next.key),cert:await readFile(next.cert)};
        if(next.lanIP!==mobileConfig.lanIP||!tls.listening){
          if(tls.listening){tls.closeAllConnections();await new Promise(resolve=>tls.close(resolve));}
          Object.assign(mobileConfig,next);tls.setSecureContext(credentials);tls.listen(4319,next.lanIP);
        }else{Object.assign(mobileConfig,next);tls.setSecureContext(credentials);}
        lastRenewal=Date.now();
      }catch(error){console.error('手机证书更新失败：'+error.message);}finally{renewing=false;}
    };
    setInterval(refreshTLS,30000).unref();
  }
  if(mobileConfig){try{await startMobile(mobileConfig);setMobileConfig(mobileConfig);}catch(error){console.error('手机入口启动失败：'+error.message);mobileConfig=null;}}
  const port=Number(process.env.RCM_PORT||4317);
  server.listen(port,'127.0.0.1',()=>console.log(`Remote Codex Manager: http://127.0.0.1:${server.address().port}`));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const m of managers.values())m.disconnect({preserveIntent:true});server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();});
}
