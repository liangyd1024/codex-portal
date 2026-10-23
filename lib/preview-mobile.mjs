import {readFile,writeFile,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {networkInterfaces} from 'node:os';
import path from 'node:path';

const execute=promisify(execFile);
const failure=(message,status=409)=>Object.assign(new Error(message),{status});

// This controller never invokes the production installer or Tailscale Serve.
// The caller supplies the already validated, private preview directory.
export function createPreviewMobileSetup({directory,root,app,listen,
  run=(command,args)=>execute(command,args,{timeout:30000}),
  address=()=>process.env.RCM_PREVIEW_LAN_IP||Object.values(networkInterfaces()).flat().find(n=>n?.family==='IPv4'&&!n.internal)?.address,
  warn=message=>console.error(message)}){
  if(!path.isAbsolute(directory))throw Error('验收手机目录必须为绝对路径。');
  let pending=false,secure;
  return async(mode='lan')=>{
    if(mode!=='lan')throw failure('独立验收入口不修改整机 Tailscale 转发。请使用本次验收的局域网入口。');
    if(pending)throw failure('手机入口正在配置，请稍后重新检查。');
    pending=true;
    try{
      const lanIP=address();
      if(!lanIP||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lanIP)||lanIP.split('.').some(n=>Number(n)>255))throw failure('没有可用的局域网 IPv4 地址。');
      const ca=path.join(directory,'Codex-Local-CA.crt'),caKey=path.join(directory,'ca.key');
      const key=path.join(directory,'server.key'),cert=path.join(directory,'server.crt');
      const configFile=path.join(directory,'config.json');
      let old;
      try{old=JSON.parse(await readFile(configFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      const openssl=args=>run('/usr/bin/openssl',args);
      try{await readFile(ca);}catch(error){
        if(error.code!=='ENOENT')throw error;
        await openssl(['req','-x509','-newkey','rsa:3072','-nodes','-keyout',caKey,'-out',ca,'-days','30','-subj','/CN=RCM Preview Access CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
        await chmod(caKey,0o600);
      }
      await readFile(caKey);
      let reusable=old?.lanIP===lanIP;
      if(reusable){try{await readFile(key);await openssl(['x509','-checkend','86400','-noout','-in',cert]);}catch{reusable=false;}}
      if(!reusable){
        const ext=path.join(directory,'server.ext'),csr=path.join(directory,'server.csr');
        await writeFile(ext,`subjectAltName=IP:${lanIP},IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,{mode:0o600});
        await openssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout',key,'-out',csr,'-subj','/CN=RCM Preview Workbench']);
        await chmod(key,0o600);
        await openssl(['x509','-req','-in',csr,'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',cert,'-days','30','-sha256','-extfile',ext]);
      }
      const next={lanIP,origins:[`https://${lanIP}:4339`,'https://127.0.0.1:4339'],ca,key,cert};
      const credentials={key:await readFile(key),cert:await readFile(cert)};
      if(secure?.listening)secure.setSecureContext(credentials);
      else{
        secure=app.createSecureServer(credentials);await app.ready();
        const startedProxy=!app.proxyServer.listening;
        try{
          if(startedProxy)await listen(app.proxyServer,4338,'127.0.0.1');
          await listen(secure,4339,'0.0.0.0');
        }catch(error){
          if(startedProxy&&app.proxyServer.listening)await new Promise(resolve=>app.proxyServer.close(resolve));
          throw error;
        }
      }
      await writeFile(configFile,JSON.stringify(next,null,2),{mode:0o600});
      app.setMobileConfig(next);
      try{await run('/usr/bin/osascript',['-l','JavaScript',path.join(root,'scripts/mobile-qr.js'),next.origins[0],path.join(directory,'lan.png')]);}
      catch{warn('验收二维码生成失败；HTTPS 入口仍可直接访问。');}
      return next;
    }finally{pending=false;}
  };
}
