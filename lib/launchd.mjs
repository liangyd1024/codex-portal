import {spawnSync} from 'node:child_process';
export function launchdService(domain,label,{spawn=spawnSync,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timeoutMs=15000}={}){
 const call=args=>spawn('/bin/launchctl',args,{encoding:'utf8'});
 const registered=()=>call(['print',domain+'/'+label]).status===0;
 return {registered,async stop(){
  if(!registered())return;
  const result=call(['bootout',domain+'/'+label]);
  if(result.status!==0&&registered())throw Error('无法停止网页服务：'+result.stderr);
  const deadline=now()+timeoutMs;
  while(registered()){if(now()>=deadline)throw Error('网页服务尚未注销，请稍后重试。');await wait(150);}
 },async start(job){
  const deadline=now()+timeoutMs;let result;
  do{result=call(['bootstrap',domain,job]);if(result.status===0)return;await wait(250);}while(now()<deadline);
  throw Error('无法注册网页服务：'+result.stderr);
 }};
}
