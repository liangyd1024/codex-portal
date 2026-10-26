import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './config.mjs';
const sessions=new Map();
const valid=ref=>/^(keychain|session):[a-f0-9-]{36}$/.test(ref||'');
export function validatePassword(password){if(typeof password!=='string'||!password||Buffer.byteLength(password)>4096||/[\r\n\0]/.test(password))throw Object.assign(Error('请输入有效的 SSH 密码（不含换行）。'),{status:400,code:'SSH_PASSWORD_INVALID'});}
export function keychain(operation,reference,password){
 return new Promise((resolve,reject)=>{
  let python='/usr/bin/python3';try{python=loadConfig().connections.find(h=>h.kind==='local')?.python||python;}catch{}
  const child=spawn(python,[fileURLToPath(new URL('../scripts/ssh-keychain.py',import.meta.url))],{stdio:['pipe','pipe','ignore']});let output='';
  const fail=()=>reject(Object.assign(Error('无法访问 macOS 钥匙串。请确认登录钥匙串已解锁，或取消“记住密码”后重试。'),{status:409,code:'KEYCHAIN_UNAVAILABLE'}));
  const timer=setTimeout(()=>{child.kill();fail();},10000);
  child.on('error',()=>{clearTimeout(timer);fail();});child.stdout.on('data',part=>{output+=part;if(output.length>16384){child.kill();fail();}});child.stdin.on('error',()=>{});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return fail();try{const result=JSON.parse(output);if(result.error)return fail();resolve(result);}catch{fail();}});
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
