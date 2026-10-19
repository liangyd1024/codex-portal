import {readFile} from 'node:fs/promises';

// A discovery hint, not a project assignment or a second thread lifecycle.
// Never retry thread/start, turn/start or a native metadata write here.
export async function refreshDesktopDiscovery(manager,id,{delays=[0,250,1000,3000],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>manager.rpc===rpc&&manager.generation===generation&&rpc?.connected;
  try {
    await manager.titleJobs.get(id);
    const script=await readFile(new URL('../scripts/desktop-notify.py',import.meta.url),'utf8');
    const encoded=Buffer.from(JSON.stringify({threadId:id,action:'created'})).toString('base64');
    for(const delay of delays){
      if(!current())return;
      if(delay)await wait(delay);
      if(!current())return;
      const result=await manager.remote(`import base64,json\nPAYLOAD=json.loads(base64.b64decode('${encoded}'))\n${script}`,{timeoutMs:10000});
      if(!current())return;
      if(result.status==='notified'||result.status==='notRunning')return result;
      if(result.status!=='pendingPersistence')throw Error('桌面会话列表刷新未获确认。');
    }
    throw Error('新会话尚未落盘，桌面列表将等待原生刷新。');
  } catch(error) {
    if(current())manager.record(error,'刷新桌面新会话列表',{diagnosticOnly:true});
  }
}
