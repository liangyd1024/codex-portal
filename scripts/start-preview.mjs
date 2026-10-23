import {readFile,readdir,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir,networkInterfaces} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {WebUpdate} from '../lib/web-update.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const build=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
const stateRoot=process.env.RCM_PREVIEW_ROOT||await mkdtemp(path.join(tmpdir(),'rcm-framework-preview-'));
if(!path.isAbsolute(stateRoot))throw Error('验收状态目录必须为绝对路径。');
await mkdir(stateRoot,{recursive:true,mode:0o700});
const marker=path.join(stateRoot,'preview-owner.json');
try{if(JSON.parse(await readFile(marker,'utf8')).purpose!=='rcm-framework-preview')throw Error('不是本次验收的状态目录。');}catch(error){if(error.code!=='ENOENT')throw error;if((await readdir(stateRoot)).length)throw Error('不能复用非空目录作为新验收状态目录。');await writeFile(marker,JSON.stringify({purpose:'rcm-framework-preview'}),{mode:0o600});}
const support=path.join(stateRoot,'support'),state=path.join(stateRoot,'state'),mobile=path.join(support,'mobile');
await mkdir(mobile,{recursive:true,mode:0o700});await mkdir(state,{recursive:true,mode:0o700});
await mkdir(path.join(stateRoot,'logs'),{recursive:true,mode:0o700});
const {createWriteStream}=await import('node:fs');
const log=createWriteStream(path.join(stateRoot,'logs','preview-'+Date.now()+'.log'),{flags:'a',mode:0o600});
for(const output of [process.stdout,process.stderr]){const write=output.write.bind(output);output.write=(chunk,...args)=>{log.write(chunk);return write(chunk,...args);};}
const {createFrameworkApp,PreviewMobileAccess}=await import(pathToFileURL(path.join(build.output,'server/application.mjs')).href);
const staticRoot=path.join(build.output,'public'),extraAssets={};
async function assets(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await assets(path.join(directory,entry.name),relative+'/');else extraAssets['/'+relative]=relative;}}
await assets(staticRoot);
const access=new PreviewMobileAccess(path.join(mobile,'sessions.json'));
const updater=new WebUpdate({supportDir:support,root:build.output,version:build.version});
const liveConfig=loadConfig();
const configFile=path.join(stateRoot,'connections.json');await writeFile(configFile,JSON.stringify(liveConfig,null,2),{mode:0o600});
const app=await createFrameworkApp({config:liveConfig,stateDir:state,staticRoot,extraAssets,buildVersion:build.version,access,updater});
const listen=(server,port,host)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
await listen(app.server,4327,'127.0.0.1');
let secure;
if(process.argv.includes('--mobile')){
 const lanIP=process.env.RCM_PREVIEW_LAN_IP||Object.values(networkInterfaces()).flat().find(n=>n?.family==='IPv4'&&!n.internal)?.address;
 if(!lanIP)throw Error('没有可用的局域网 IPv4 地址。');
 const invoke=args=>{const r=spawnSync('/usr/bin/openssl',args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(r.stderr||'无法创建验收证书。');};
 const ca=path.join(mobile,'Codex-Local-CA.crt'),caKey=path.join(mobile,'ca.key'),key=path.join(mobile,'server.key'),cert=path.join(mobile,'server.crt');
 try{await readFile(ca);}catch(e){if(e.code!=='ENOENT')throw e;invoke(['req','-x509','-newkey','rsa:3072','-nodes','-keyout',caKey,'-out',ca,'-days','30','-subj','/CN=RCM Preview Access CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);}
 const ext=path.join(mobile,'server.ext'),csr=path.join(mobile,'server.csr');
 await writeFile(ext,`subjectAltName=IP:${lanIP},IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,{mode:0o600});
 invoke(['req','-new','-newkey','rsa:2048','-nodes','-keyout',key,'-out',csr,'-subj','/CN=RCM Preview Workbench']);
 invoke(['x509','-req','-in',csr,'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',cert,'-days','30','-sha256','-extfile',ext]);
 const {chmod}=await import('node:fs/promises');await chmod(key,0o600);await chmod(caKey,0o600);
 const mobileConfig={lanIP,origins:[`https://${lanIP}:4339`,'https://127.0.0.1:4339'],ca,key,cert};
 app.setMobileConfig(mobileConfig);
 secure=app.createSecureServer({key:await readFile(key),cert:await readFile(cert)});await app.ready();
 await listen(app.proxyServer,4338,'127.0.0.1');await listen(secure,4339,'0.0.0.0');
 await writeFile(path.join(mobile,'config.json'),JSON.stringify(mobileConfig,null,2),{mode:0o600});
 // QR generation uses the existing renderer and writes only within the preview support directory.
 const qr=spawnSync('/usr/bin/osascript',['-l','JavaScript',path.join(root,'scripts/mobile-qr.js'),mobileConfig.origins[0],path.join(mobile,'lan.png')],{encoding:'utf8',timeout:10000});
 if(qr.status!==0)console.error('验收二维码生成失败；HTTPS 入口仍可直接访问。');
}
await writeFile(path.join(root,'.framework-build/preview.json'),JSON.stringify({pid:process.pid,stateRoot,build:build.output,version:build.version,ports:[4327,...(secure?[4338,4339]:[])]},null,2),{mode:0o600});
console.log('验收服务已启动：4327'+(secure?' / 4338 / 4339':''));
let closing=false;async function close(){if(closing)return;closing=true;await app.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
