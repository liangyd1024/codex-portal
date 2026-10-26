import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './config.mjs';
const sessions=new Map();
const valid=ref=>/^(keychain|session):[a-f0-9-]{36}$/.test(ref||'');
export function validatePassword(password){if(typeof password!=='string'||!password||Buffer.byteLength(password)>4096||/[\r\n\0]/.test(password))throw Object.assign(Error('请输入有效的 SSH 密码（不含换行）。'),{status:400,code:'SSH_PASSWORD_INVALID'});}
function keychainError(operation,osStatus,timeout=false){
 let code='KEYCHAIN_UNAVAILABLE',message='无法访问运行网页服务的 Mac 钥匙串。请检查本机 Python 和钥匙串状态后重试。';
 if(timeout){code='KEYCHAIN_TIMEOUT';message='读取或保存 SSH 凭据超时。请解锁运行网页服务的 Mac 后重试。';}
 else if(osStatus===-25300&&operation==='read'){code='SSH_PASSWORD_REQUIRED';message='已保存的 SSH 密码条目不存在。请在“管理连接”中重新输入密码。';}
 else if([-25293,-25308,-25315].includes(osStatus)){code='KEYCHAIN_ACCESS_DENIED';message='macOS 拒绝访问已保存的 SSH 凭据。请先解锁运行网页服务的 Mac 屏幕和登录钥匙串，再重试连接。若仍失败，请在该 Mac 的“钥匙串访问”中检查 CodexPortal.SSH 的访问控制。';}
 return Object.assign(Error(message),{status:409,code,...Number.isInteger(osStatus)?{osStatus}:{}});
}
export function keychain(operation,reference,password,{spawnProcess=spawn,timeoutMs=10000}={}){
 return new Promise((resolve,reject)=>{
  let python='/usr/bin/python3';try{python=loadConfig().connections.find(h=>h.kind==='local')?.python||python;}catch{}
  let child;try{child=spawnProcess(python,[fileURLToPath(new URL('../scripts/ssh-keychain.py',import.meta.url))],{stdio:['pipe','pipe','ignore']});}catch{return reject(keychainError(operation));}
  let output='',settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{finish(keychainError(operation,undefined,true));child.kill();},timeoutMs);
  child.on('error',()=>finish(keychainError(operation)));child.stdout.on('data',part=>{if(settled)return;output+=part;if(output.length>16384){finish(keychainError(operation));child.kill();}});child.stdin.on('error',()=>{});
  child.on('close',code=>{if(settled)return;try{const result=JSON.parse(output);if(result?.error)return finish(keychainError(operation,result.osStatus));if(code!==0||!result||typeof result!=='object')return finish(keychainError(operation));finish(null,result);}catch{finish(keychainError(operation));}});
  child.stdin.end(JSON.stringify({operation,reference,...password===undefined?{}:{password}}));
 });
}
export async function saveCredential(password,remember=true,{vault=keychain}={}){validatePassword(password);const ref=(remember?'keychain:':'session:')+randomUUID();if(remember){try{await vault('save',ref,password);}catch(error){await vault('delete',ref).catch(()=>{});throw error;}}else sessions.set(ref,password);return ref;}
export async function readCredential(ref,{vault=keychain}={}){
 if(!valid(ref))throw Error('SSH 凭据引用无效。');
 const password=ref.startsWith('session:')?sessions.get(ref):(await vault('read',ref)).password;
 if(!password)throw Object.assign(Error('SSH 密码已失效，请在管理连接中重新输入。'),{code:'SSH_PASSWORD_REQUIRED'});return password;
}
export async function deleteCredential(ref,{vault=keychain}={}){if(!valid(ref))return;if(ref.startsWith('session:'))sessions.delete(ref);else await vault('delete',ref);}
