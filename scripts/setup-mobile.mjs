import {mkdirSync,existsSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
const dir=path.join(homedir(),'Library/Application Support/RemoteCodexManager/mobile');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:10000});if(r.status!==0)throw Error(r.stderr||r.stdout||'命令失败：'+cmd);return r.stdout.trim();}
const route=run('/sbin/route',['-n','get','default']);const iface=/interface:\s*(\S+)/.exec(route)?.[1]||'en0';
const ip=run('/usr/sbin/ipconfig',['getifaddr',iface]);if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip))throw Error('没有可用的局域网 IPv4 地址。');
const ts=JSON.parse(run('/usr/local/bin/tailscale',['status','--json']));const dns=ts.Self?.DNSName?.replace(/\.$/,'');if(!dns)throw Error('Tailscale 尚未登录。');
const ca=path.join(dir,'Codex-Local-CA.crt'),caKey=path.join(dir,'ca.key'),key=path.join(dir,'server.key'),cert=path.join(dir,'server.crt');
if(!existsSync(ca)){run('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-nodes','-keyout',caKey,'-out',ca,'-days','3650','-subj','/CN=Codex Local Access CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);chmodSync(caKey,0o600);}
let old={};try{old=JSON.parse(readFileSync(path.join(dir,'config.json'),'utf8'));}catch{}
if(old.lanIP!==ip||!existsSync(cert)||spawnSync('/usr/bin/openssl',['x509','-checkend','2592000','-noout','-in',cert]).status!==0){
 run('/usr/bin/openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',key,'-out',path.join(dir,'server.csr'),'-subj','/CN=Codex Local Workbench']);chmodSync(key,0o600);
 const ext=path.join(dir,'server.ext');writeFileSync(ext,`subjectAltName=IP:${ip}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
 run('/usr/bin/openssl',['x509','-req','-in',path.join(dir,'server.csr'),'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',cert,'-days','365','-sha256','-extfile',ext]);
}
const origins=[`https://${dns}`,`https://${ip}:4319`];
writeFileSync(path.join(dir,'config.json'),JSON.stringify({lanIP:ip,origins,ca,key,cert},null,2),{mode:0o600});
const python=path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
for(const [i,name] of ['tailscale','lan'].entries())run(python,['-c','import qrcode,sys; qrcode.make(sys.argv[1]).save(sys.argv[2])',origins[i],path.join(dir,name+'.png')]);
console.log(JSON.stringify({origins,ca,config:path.join(dir,'config.json')},null,2));
