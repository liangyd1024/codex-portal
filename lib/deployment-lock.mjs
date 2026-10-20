import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function processAlive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
export async function deploymentLock(file,delegatedToken){
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 for(let i=0;i<2;i++){
  let handle;
  try{handle=await open(file,'wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner;try{owner=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('部署锁正在建立或不可读取，请稍后重试。');}
   if(delegatedToken&&owner.token===delegatedToken&&processAlive(owner.pid))return {token:owner.token,release:async()=>{}};
   if(processAlive(owner.pid))throw Error('已有更新或部署正在进行，请等待完成。');
   throw Error('上次部署异常中断，请先核对服务状态并清理部署锁：'+file);
  }
  const token=randomUUID();await handle.writeFile(JSON.stringify({pid:process.pid,token}));await handle.close();
  return {token,release:async()=>{try{if(JSON.parse(await readFile(file,'utf8')).token===token)await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}};
 }
 throw Error('无法取得部署锁，请稍后重试。');
}
