import {readFile,writeFile,rename} from 'node:fs/promises';
import {startSharedEngineBridge} from '../lib/shared-engine-bridge.mjs';
const file=process.argv[2];
if(!file)throw Error('缺少共享连接配置路径。');
const config=JSON.parse(await readFile(file,'utf8'));
let serial=Promise.resolve();const startedAt=Date.now();
const save=connections=>{serial=serial.then(async()=>{await writeFile(file+'.status.tmp',JSON.stringify({pid:process.pid,port:config.port,startedAt,connections})+'\n',{mode:0o600});await rename(file+'.status.tmp',file+'.status');}).catch(()=>{console.error('共享连接状态无法保存，桥接已停止。');process.exit(1);});};
const bridge=await startSharedEngineBridge({...config,onConnections:save});save(0);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void bridge.close().then(()=>process.exit(0));});
