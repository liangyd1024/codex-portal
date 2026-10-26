import {readFileSync} from 'node:fs';
import {homedir,userInfo} from 'node:os';
import path from 'node:path';
export const supportDir=path.join(homedir(),'Library/Application Support/RemoteCodexManager');
export const configPath=process.env.RCM_CONFIG||path.join(supportDir,'connections.json');
export function validateConfig(c,{checkLocal=true}={}){
 const ids=new Set();let locals=0;const id=/^[a-zA-Z0-9_-]{1,64}$/;
 if(c?.formatVersion!==1||!id.test(c.machineId||'')||!Array.isArray(c.connections)||!c.connections.length)throw Error('连接配置格式无效。');
 for(const h of c.connections){
  if(!id.test(h.id||'')||ids.has(h.id)||!id.test(h.machineId||''))throw Error('连接 ID 或机器标识无效。');ids.add(h.id);
  if(!['local','ssh'].includes(h.kind)||!h.alias||!/^\w[\w.-]*$/.test(h.user||''))throw Error('连接身份字段无效。');
  for(const k of ['home','binary'])if(typeof h[k]!=='string'||!path.isAbsolute(h[k])||/[\n\r\0]/.test(h[k]))throw Error('连接路径无效：'+k);
  if(h.python!==undefined&&(typeof h.python!=='string'||!path.isAbsolute(h.python)||/[\n\r\0]/.test(h.python)))throw Error('Python 路径无效。');
  if(h.threadUnloadDelaySecs!==undefined&&(!Number.isSafeInteger(h.threadUnloadDelaySecs)||h.threadUnloadDelaySecs<0||h.threadUnloadDelaySecs>86400))throw Error('会话释放等待必须为 0 到 86400 秒的整数。');
  if(h.autoReloadLogin!==undefined&&!['off','interrupt'].includes(h.autoReloadLogin))throw Error('自动登录恢复策略无效。');
  h.dataDir=path.join(h.home,'.codex/remote-codex-manager');
  if(h.kind==='local'){locals++;h.address='127.0.0.1';if(h.machineId!==c.machineId||checkLocal&&(h.home!==homedir()||h.user!==userInfo().username))throw Error('本机身份不符。');}
  else if(!/^[a-zA-Z0-9_.:-]+$/.test(h.address||'')||!Number.isInteger(h.port)||h.port<1||h.port>65535||(h.identityFile!==undefined&&h.identityFile!==''&&(!path.isAbsolute(h.identityFile)||/[\n\r\0]/.test(h.identityFile))))throw Error('SSH 配置无效。');
 }
 if(locals!==1||!ids.has(c.defaultConnection))throw Error('必须配置一个本机连接和有效默认连接。');return c;
}
export function loadConfig(file=configPath){return validateConfig(JSON.parse(readFileSync(file,'utf8')));}
export function publicHost(h){const {identityFile,...safe}=h;return safe;}
export function pythonPrefix(h){return `SERVICE_HOME=${JSON.stringify(h.home)}\nSERVICE_USER=${JSON.stringify(h.user)}\nSERVICE_BINARY=${JSON.stringify(h.binary)}\nSERVICE_PYTHON=${JSON.stringify(h.python||'/usr/bin/python3')}\nSERVICE_THREAD_UNLOAD_DELAY_SECS=${h.threadUnloadDelaySecs??'None'}\nSTORE_HOME=SERVICE_HOME\n`;}

export const shellWord=value=>"'"+String(value).replaceAll("'","'\"'\"'")+"'";
