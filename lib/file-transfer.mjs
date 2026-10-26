import {prepareSshAuth} from './ssh-auth.mjs';
import {spawn} from 'node:child_process';
import {Transform} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {pythonPrefix,shellWord} from './config.mjs';
import {sshArgs} from './transports/ssh-options.mjs';

// Keep bytes out of the JSON RPC / engine channel. Both transports use the same
// scoped reader, one process per HTTP request, with backpressure and cancellation.
export async function openFileTransfer(host,payload,{signal}={}) {
  const reader=await readFile(new URL('../scripts/file-reader.py',import.meta.url),'utf8');
  const code=pythonPrefix(host)+'import json,base64\nFILE_PAYLOAD=json.loads(base64.b64decode('+JSON.stringify(Buffer.from(JSON.stringify(payload)).toString('base64'))+'))\n'+reader;
  return runFileReader(host,code,{signal});
}

export async function runFileReader(host,code,{signal}={}) {
  signal?.throwIfAborted();
  const local=host.kind==='local';
  const auth=local?{env:process.env,close(){}}:await prepareSshAuth(host);
  if(signal?.aborted){auth.close();signal.throwIfAborted();}
  let child;try{child=spawn(local?(host.python||'/usr/bin/python3'):'/usr/bin/ssh',local?['-']:[...sshArgs(host,{reuse:true}),`${host.user}@${host.address}`,'/bin/bash --noprofile --norc -s'],{stdio:['pipe','pipe','pipe'],env:auth.env});}catch(error){auth.close();throw error;}
  child.once('close',()=>auth.close());child.once('error',()=>auth.close());
  let header=Buffer.alloc(0),received=false,stderr='',settled=false,timer;
  let resolveHeader,rejectHeader;
  const ready=new Promise((resolve,reject)=>{resolveHeader=resolve;rejectHeader=reject;});
  const stop=()=>{child.kill('SIGTERM');};
  const fail=error=>{if(!settled){settled=true;rejectHeader(error);}body.destroy(error);stop();};
  const resetTimer=()=>{clearTimeout(timer);timer=setTimeout(()=>fail(new Error('文件传输超时，请检查目标连接后重试。')),120000);timer.unref();};
  const body=new Transform({transform(chunk,encoding,callback){
    resetTimer();
    if(received){callback(null,chunk);return;}
    header=Buffer.concat([header,chunk]);
    const index=header.indexOf(10);
    if(index<0){if(header.length>16384)callback(new Error('文件响应头无效。'));else callback();return;}
    try {
      if(index>16384)throw new Error('文件响应头过大。');
      const meta=JSON.parse(header.subarray(0,index).toString('utf8'));
      received=true;settled=true;resolveHeader({meta,body,cancel:stop});
      callback(null,header.subarray(index+1));header=null;
    } catch(error){callback(error);}
  }});
  const abort=()=>fail(new Error('文件读取已取消。'));
  body.on('error',error=>{if(!settled){settled=true;rejectHeader(error);}stop();});
  body.on('close',stop);
  child.on('error',fail);
  child.stderr.on('data',chunk=>{stderr=auth.env.RCM_ASKPASS_SOCKET?'请检查 SSH 登录。':(stderr+chunk.toString()).slice(-2000);});
  child.stdin.on('error',()=>{});
  child.on('close',code=>{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(!received)fail(auth.failure||new Error('无法读取目标文件，请检查连接。'+stderr));
    else if(code!==0&&!body.destroyed)body.destroy(new Error('文件传输中断，请重试。'));
  });
  signal?.addEventListener('abort',abort,{once:true});resetTimer();
  child.stdout.pipe(body);
  child.stdin.end(local?code:`${shellWord(host.python||'/usr/bin/python3')} - <<'RCM_FILE_READER'\n${code}\nRCM_FILE_READER\n`);
  return ready;
}
