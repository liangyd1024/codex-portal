import {loadConfig} from '../lib/config.mjs';
import {createLocalTransport} from '../lib/local.mjs';
import {RpcClient} from '../lib/rpc-client.mjs';
import {existsSync} from 'node:fs';
const config=loadConfig(),host=config.connections.find(h=>h.kind==='local');
if(!existsSync(host.dataDir+'/app-server.sock')){console.log(JSON.stringify({idle:true,service:false}));process.exit(0);}
const tunnel=await createLocalTransport(host).tunnelFactory(),rpc=new RpcClient();
try{
 await rpc.connect(tunnel.url);
 const {data:ids}=await rpc.request('thread/loaded/list');
 if(!Array.isArray(ids))throw Error('无法读取已加载会话。');
 const blockers=[];
 for(const id of ids){
  const {thread}=await rpc.request('thread/read',{threadId:id,includeTurns:false});
  if(!thread?.status||thread.status.type==='active')blockers.push({thread:id,reason:'运行中或状态未知'});
  const {goal}=await rpc.request('thread/goal/get',{threadId:id}).catch(e=>{if(/^ephemeral thread does not support goals(?::|$)/i.test(e.message))return {goal:null};throw e;});
  if(goal?.status==='active')blockers.push({thread:id,reason:'目标仍在运行'});
  const terminals=await rpc.request('thread/backgroundTerminals/list',{threadId:id,limit:100});
  if(!Array.isArray(terminals.data)||terminals.data.length||terminals.nextCursor)blockers.push({thread:id,reason:'后台命令或状态未知'});
  const queue=await rpc.request('thread/queue/list',{threadId:id,limit:1});
  if(!Array.isArray(queue.data)||queue.data.length||queue.nextCursor)blockers.push({thread:id,reason:'排队输入或状态未知'});
 }
 if(blockers.length)throw Error('服务不空闲：'+JSON.stringify(blockers));
 console.log(JSON.stringify({idle:true,service:true,checkedThreads:ids.length}));
}finally{rpc.close();tunnel.child.kill();}
