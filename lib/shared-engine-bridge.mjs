import http from 'node:http';
import net from 'node:net';
import {lstat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import path from 'node:path';

// A transport only: native RPC frames and lifecycle remain owned by Codex.
export async function startSharedEngineBridge({socketPath,token,port=4330,onConnections=(_count)=>{}}) {
 if(!path.isAbsolute(socketPath)||!/^[a-f0-9]{64}$/.test(token)||!Number.isInteger(port)||port<0||port>65535)throw Error('共享连接参数无效。');
 const verify=async()=>{
  const [socket,parent]=await Promise.all([lstat(socketPath),lstat(path.dirname(socketPath))]);
  if(!socket.isSocket()||socket.uid!==process.getuid()||!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o022))throw Error('原生连接身份或权限不符。');
 };
 await verify();
 const connections=new Set();let upgraded=0;
 const server=http.createServer({maxHeaderSize:8192},(_req,res)=>{res.writeHead(404);res.end();});
 server.maxConnections=32;server.maxHeadersCount=32;server.headersTimeout=5000;server.requestTimeout=5000;
 server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
 server.on('clientError',(_error,socket)=>socket.destroy());
 server.on('upgrade',(req,client,head)=>{
  client.on('error',()=>client.destroy());
  const expected=Buffer.from('/rpc/'+token),actual=Buffer.from(req.url||'');
  if(req.method!=='GET'||req.headers.origin!==undefined||req.headers.upgrade?.toLowerCase()!=='websocket'||actual.length!==expected.length||!timingSafeEqual(actual,expected)||client.remoteAddress!=='127.0.0.1'){
   client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
  }
  client.pause();
  void verify().then(()=>{
   if(client.destroyed)return;
   const upstream=net.connect(socketPath);connections.add(upstream);upgraded++;onConnections(upgraded);let closed=false;
   const close=()=>{if(closed)return;closed=true;client.destroy();upstream.destroy();connections.delete(upstream);upgraded--;onConnections(upgraded);};
   client.on('error',close);upstream.on('error',close);client.on('close',close);upstream.on('close',close);
   upstream.once('connect',()=>{
    const headers=['GET / HTTP/1.1','Host: localhost','Connection: Upgrade','Upgrade: websocket'];
    for(const name of ['sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions'])if(req.headers[name])headers.push(name+': '+req.headers[name]);
    upstream.write(headers.join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);
    client.pipe(upstream);upstream.pipe(client);client.resume();
   });
  }).catch(()=>client.destroy());
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {port:server.address().port,close:()=>new Promise(resolve=>{for(const socket of connections)socket.destroy();server.close(resolve);})};
}
