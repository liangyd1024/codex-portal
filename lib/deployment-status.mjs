// Read only through an already connected native RPC. Never connect/resume a target.
export async function deploymentStatus(manager){
 const snapshot=manager.status();
 if(snapshot.connection.state!=='connected'||!snapshot.controlledSessions.length)return snapshot;
 const rpc=manager.rpc,generation=manager.generation,revision=manager.statusRevision;
 const sessions=await Promise.all(snapshot.controlledSessions.map(async session=>{
  const {thread}=await rpc.request('thread/read',{threadId:session.id,includeTurns:false},{timeoutMs:5000});
  if(!thread?.status?.type)throw Error('无法核对会话的原生状态。');
  return {...session,name:thread.name||thread.preview?.slice(0,60)||session.id,status:thread.status};
 }));
 if(manager.rpc!==rpc||manager.generation!==generation||manager.statusRevision!==revision)throw Error('核对期间会话状态发生变化，请重试。');
 // This is a fresh deployment snapshot, not another source of native state.
 return {...manager.status(),controlledSessions:sessions};
}
