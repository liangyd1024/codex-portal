import {readFileSync} from 'node:fs';
import path from 'node:path';
// One small Portal-owned marker. Never read or modify Codex global configuration.
const cache=new Map();
export function sharedDesktopState(host,{now=Date.now()}={}) {
 if(host?.kind!=='local'||!host.dataDir)return {configured:false,activated:false};
 const file=path.join(host.dataDir,'desktop-shared.json'),prior=cache.get(file);
 if(prior&&now-prior.at<1000)return prior.state;
 let state;
 try{const value=JSON.parse(readFileSync(file,'utf8'));state={configured:true,activated:false};
  if(value.activated===true){try{const live=JSON.parse(readFileSync(file+'.status','utf8'));if(Number.isSafeInteger(live.pid)&&live.pid>0&&live.connections>0){process.kill(live.pid,0);state.activated=true;}}catch{}}}
 catch(error){state={configured:error.code!=='ENOENT',activated:false};}
 cache.set(file,{at:now,state});return state;
}
