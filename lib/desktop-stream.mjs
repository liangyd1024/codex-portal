import net from 'node:net';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Read-only owner/follower IPC. Never claims a thread or answers engine requests.
export class DesktopStream {
 constructor(host,emit){this.host=host;this.emit=emit;this.ids=new Set();this.owners=new Map();this.readyIds=new Set();this.pending=new Map();this.revisions=new Map();this.timers=new Map();this.views=false;}
 ready(id){return this.readyIds.has(id);}
 set(ids,enabled=true){
  this.views=enabled;
  const next=new Set(enabled?ids.filter(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)).slice(0,200):[]);
  for(const id of this.ids)if(!next.has(id)){this.follow(id,false);this.owners.delete(id);this.readyIds.delete(id);this.revisions.delete(id);clearTimeout(this.timers.get(id));this.timers.delete(id);}
  this.ids=next;
  if(!next.size){this.close();return;}
  if(this.clientId)this.discover();else if(!this.socket&&!this.connecting)this.connect();
 }
 send(message){if(!this.socket?.writable)return;const data=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(data.length);this.socket.write(Buffer.concat([header,data]));}
 request(method,params,threadId){const id=randomUUID();this.pending.set(id,{method,threadId});this.send({type:'request',requestId:id,sourceClientId:this.clientId||'initializing-client',version:method==='initialize'?0:1,method,params});}
 follow(id,following){const owner=this.owners.get(id);if(owner)this.send({type:'broadcast',sourceClientId:this.clientId,targetClientIds:[owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:id,following}});}
 discover(){for(const id of this.ids)if(!this.owners.has(id)&&![...this.pending.values()].some(p=>p.threadId===id))this.request('thread-owner-discovery',{hostId:'local',conversationId:id},id);}
 async connect(){
  if(this.host.kind!=='local'||!this.views)return;
  const token={};this.connecting=token;
  try{
   let endpoint;
   for(const file of [path.join(this.host.home,'.codex/ipc/ipc.sock'),`/tmp/codex-ipc/ipc-${process.getuid()}.sock`]){
    try{const [s,p]=await Promise.all([lstat(file),lstat(path.dirname(file))]);if(!s.isSocket()||s.uid!==process.getuid()||!p.isDirectory()||p.uid!==process.getuid()||(s.mode&0o077)||(p.mode&0o022))throw Error('IPC identity mismatch');endpoint=file;break;}catch(e){if(e.code!=='ENOENT')throw e;}
   }
   if(!endpoint)throw Error('Desktop IPC unavailable');
   if(this.connecting!==token||!this.ids.size)return;
   const socket=net.createConnection(endpoint);this.socket=socket;let buffer=Buffer.alloc(0);
   socket.on('connect',()=>this.request('initialize',{clientType:'remote-codex-manager'}));
   socket.on('data',chunk=>{if(this.socket!==socket)return;try{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE();if(!size||size>16*1024*1024)throw Error('Invalid IPC frame');if(buffer.length<4+size)break;const msg=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);this.message(msg);}}catch{socket.destroy();}});
   socket.on('error',()=>socket.destroy());socket.on('close',()=>{if(this.socket===socket){this.socket=null;this.reset();this.retry();}});
   this.handshake=setTimeout(()=>{if(!this.clientId)socket.destroy();},5000);this.handshake.unref?.();
  }catch{this.retry();}finally{if(this.connecting===token)this.connecting=null;}
 }
 retry(){clearTimeout(this.retryTimer);if(this.ids.size&&this.views){this.retryTimer=setTimeout(()=>{if(this.socket)this.discover();else this.connect();},5000);this.retryTimer.unref?.();}}
 changed(id,ready,immediate=false){
  if(immediate){clearTimeout(this.timers.get(id));this.timers.delete(id);this.emit({threadId:id,ready});return;}
  if(!this.timers.has(id)){const timer=setTimeout(()=>{this.timers.delete(id);if(this.ids.has(id))this.emit({threadId:id,ready:this.ready(id)});},750);timer.unref?.();this.timers.set(id,timer);}
 }
 message(m){
  if(m.type==='client-discovery-request'){this.send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
  if(m.type==='response'){
   const p=this.pending.get(m.requestId);if(!p)return;this.pending.delete(m.requestId);
   if(p.method==='initialize'){if(m.resultType!=='success'||!m.result?.clientId){this.socket?.destroy();return;}this.clientId=m.result.clientId;clearTimeout(this.handshake);this.discover();this.audit=setInterval(()=>{for(const id of this.ids)if(![...this.pending.values()].some(p=>p.threadId===id))this.request('thread-owner-discovery',{hostId:'local',conversationId:id},id);},30000);this.audit.unref?.();return;}
   if(this.ids.has(p.threadId)&&m.resultType==='success'&&m.handledByClientId){const previous=this.owners.get(p.threadId);this.owners.set(p.threadId,m.handledByClientId);if(previous!==m.handledByClientId){this.readyIds.delete(p.threadId);if(previous)this.changed(p.threadId,false,true);this.follow(p.threadId,true);}}else {if(this.owners.delete(p.threadId)){this.readyIds.delete(p.threadId);this.changed(p.threadId,false,true);}this.retry();}return;
  }
  if(m.type!=='broadcast')return;
  if(m.method==='thread-stream-following-status-requested'){const id=m.params?.conversationId;if(this.ids.has(id)){this.owners.delete(id);this.readyIds.delete(id);this.changed(id,false,true);this.discover();}return;}
  if(m.method==='ipc-connection-reset'){this.socket?.destroy();return;}
  if(m.method!=='thread-stream-state-changed'||m.version!==11)return;
  const p=m.params,id=p?.conversationId,c=p?.change;
  if(!this.ids.has(id)||p.hostId!=='local'||m.sourceClientId!==this.owners.get(id))return;
  if(c?.type==='snapshot'&&c.conversationState?.id===id){const first=!this.ready(id);this.readyIds.add(id);this.revisions.set(id,c.revision);this.changed(id,true,first);}
  else if(c?.type==='patches'){
   if(!this.ready(id)||this.revisions.get(id)!==c.baseRevision){this.readyIds.delete(id);this.changed(id,false,true);this.follow(id,true);return;}
   this.revisions.set(id,c.revision);this.changed(id,true);
  }
 }
 reset(){clearInterval(this.audit);clearTimeout(this.handshake);for(const id of this.readyIds)this.changed(id,false,true);this.readyIds.clear();this.owners.clear();this.pending.clear();this.revisions.clear();this.clientId=null;}
 close(){this.connecting=null;clearTimeout(this.retryTimer);for(const id of this.ids)this.follow(id,false);const s=this.socket;this.socket=null;s?.destroy();this.reset();for(const t of this.timers.values())clearTimeout(t);this.timers.clear();}
}
