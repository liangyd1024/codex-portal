import {mkdirSync,existsSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkServe} from '../lib/tailscale-serve.mjs';
const dir=path.join(homedir(),'Library/Application Support/RemoteCodexManager/mobile');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
function run(cmd,args,timeout=10000){const r=spawnSync(cmd,args,{encoding:'utf8',timeout});if(r.error?.code==='ETIMEDOUT')throw Error('命令超时（'+timeout/1000+' 秒）：'+cmd);if(r.status!==0)throw Error(r.stderr||r.stdout||r.error?.message||'命令失败：'+cmd);return r.stdout.trim();}
const route=run('/sbin/route',['-n','get','default']);const iface=/interface:\s*(\S+)/.exec(route)?.[1]||'en0';
const ip=run('/usr/sbin/ipconfig',['getifaddr',iface]);if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip))throw Error('没有可用的局域网 IPv4 地址。');
// LAN access must work without Tailscale. Preserve only previously configured
// Tailscale entrances: a DNS name alone does not establish HTTPS Serve.

const ca=path.join(dir,'Codex-Local-CA.crt'),caKey=path.join(dir,'ca.key'),key=path.join(dir,'server.key'),cert=path.join(dir,'server.crt');
if(!existsSync(ca)){run('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-nodes','-keyout',caKey,'-out',ca,'-days','3650','-subj','/CN=Codex Local Access CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'],30000);chmodSync(caKey,0o600);}
let old={};try{old=JSON.parse(readFileSync(path.join(dir,'config.json'),'utf8'));}catch{}
if(old.lanIP!==ip||!existsSync(cert)||spawnSync('/usr/bin/openssl',['x509','-checkend','2592000','-noout','-in',cert]).status!==0){
 run('/usr/bin/openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',key,'-out',path.join(dir,'server.csr'),'-subj','/CN=Codex Local Workbench']);chmodSync(key,0o600);
 const ext=path.join(dir,'server.ext');writeFileSync(ext,`subjectAltName=IP:${ip}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
 run('/usr/bin/openssl',['x509','-req','-in',path.join(dir,'server.csr'),'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',cert,'-days','365','-sha256','-extfile',ext]);
}
let dns;
if(process.argv.includes('--tailscale')){
 const binary=['/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale','/Applications/Tailscale.app/Contents/MacOS/Tailscale'].find(existsSync);
 if(!binary)throw Error('请先在 Mac 安装并登录 Tailscale，再重试。');
 const status=JSON.parse(run(binary,['status','--json']));dns=status.Self?.DNSName?.replace(/\.$/,'');
 if(status.BackendState!=='Running'||!dns)throw Error('请先打开并登录 Tailscale，再重试。');
 if(!checkServe(JSON.parse(run(binary,['serve','status','--json'])),dns)){
  run(binary,['serve','--bg','--https=443','--yes','http://127.0.0.1:4318']);
  if(!checkServe(JSON.parse(run(binary,['serve','status','--json'])),dns))throw Error('Tailscale HTTPS 转发尚未生效，请检查 Tailscale 的 HTTPS 设置。');
 }
}
const origins=[...(old.origins||[]).filter(origin=>{try{return new URL(origin).protocol==='https:'&&new URL(origin).hostname.endsWith('.ts.net');}catch{return false;}}),`https://${ip}:4319`];
if(dns){const origin='https://'+dns;if(!origins.includes(origin))origins.unshift(origin);}
const qrScript=fileURLToPath(new URL('./mobile-qr.js',import.meta.url));
for(const origin of origins)run('/usr/bin/osascript',['-l','JavaScript',qrScript,origin,path.join(dir,origin.includes('.ts.net')?'tailscale.png':'lan.png')]);
writeFileSync(path.join(dir,'config.json'),JSON.stringify({lanIP:ip,origins,ca,key,cert},null,2),{mode:0o600});
console.log(JSON.stringify({origins,ca,config:path.join(dir,'config.json')},null,2));
