import {homedir,userInfo,hostname} from 'node:os';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {execute,decodeRemoteResult} from './ssh.mjs';
export const LOCAL_HOST=Object.freeze({alias:'本机',kind:'local',address:'127.0.0.1',home:homedir(),user:userInfo().username});
export async function localPython(code,options={}){
  const prefix=`SERVICE_HOME=${JSON.stringify(LOCAL_HOST.home)}\nSERVICE_USER=${JSON.stringify(LOCAL_HOST.user)}\nSTORE_HOME=SERVICE_HOME\n`;
  let stdout;
  try{({stdout}=await execute('/usr/bin/python3',['-'],{...options,input:prefix+code}));}
  catch(error){error.message=error.message.replace('SSH 操作超时。请检查目标机器和网络。','本机操作超时。请查看连接诊断。').replace('SSH 执行失败','本机执行失败').replace('远端返回的数据过大','本机返回的数据过大');throw error;}
  return decodeRemoteResult(stdout);
}
export async function localIdentity(){return {...LOCAL_HOST,hostname:hostname()};}
export async function localTunnel(){
  const sockets=new Set();const child=new EventEmitter();
  const server=net.createServer(client=>{
    const target=net.connect(`${LOCAL_HOST.home}/.codex/remote-codex-manager/output-relay-v2.sock`);
    sockets.add(client);sockets.add(target);
    const close=()=>{client.destroy();target.destroy();sockets.delete(client);sockets.delete(target);};
    client.on('error',close);target.on('error',close);client.on('close',close);target.on('close',close);
    client.pipe(target);target.pipe(client);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  child.kill=()=>{for(const socket of sockets)socket.destroy();server.close();};
  return {child,url:`ws://127.0.0.1:${server.address().port}`};
}
