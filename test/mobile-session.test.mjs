import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {MobileAccess} from '../lib/mobile-access.mjs';
import {createApp} from '../server.mjs';

async function entrance(file,run){
  class Manager extends EventEmitter {host={id:'local'};disconnect(){}}
  const access=new MobileAccess(file);
  const app=createApp({access,mobileConfig:{origins:['https://phone.test']},config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Manager()]])});
  await new Promise(resolve=>app.proxyServer.listen(0,'127.0.0.1',resolve));
  const request=(url,{method='GET',cookie='',csrf='',body={}}={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:app.proxyServer.address().port,path:url,method,headers:{host:'phone.test',origin:'https://phone.test',cookie,'x-csrf-token':csrf}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(text)}));
    });req.on('error',reject);req.end(method==='POST'?JSON.stringify(body):undefined);
  });
  try{await run(access,request);}finally{app.proxyServer.closeAllConnections();await new Promise(resolve=>app.proxyServer.close(resolve));}
}

test('paired phone survives server recreation while CSRF rotates; logout remains revoked after restart',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rcm-phone-restart-')),file=path.join(dir,'sessions.json');let cookie,oldCsrf,usedCode;
  await entrance(file,async(access,request)=>{
    usedCode=access.createCode().code;
    const result=await request('/api/access/login',{method:'POST',body:{code:usedCode}});
    assert.equal(result.status,200);cookie=result.headers['set-cookie'][0].split(';')[0];
    assert.match(result.headers['set-cookie'][0],/HttpOnly; Secure; SameSite=Strict; Max-Age=/);
    oldCsrf=(await request('/api/csrf',{cookie})).data.token;
  });
  await entrance(file,async(access,request)=>{
    assert.equal((await request('/api/access/status',{cookie})).status,200);
    assert.equal((await request('/api/access/login',{method:'POST',body:{code:usedCode}})).status,401);
    assert.equal((await request('/api/access/logout',{method:'POST',cookie,csrf:oldCsrf})).status,403);
    const csrf=(await request('/api/csrf',{cookie})).data.token;
    assert.notEqual(csrf,oldCsrf);
    assert.equal((await request('/api/access/logout',{method:'POST',cookie,csrf})).status,200);
  });
  await entrance(file,async(access,request)=>assert.equal((await request('/api/access/status',{cookie})).status,401));
  assert.ok(!(await readFile(file,'utf8')).includes(cookie.slice('rcm_mobile='.length)));
  console.log('保留手机重启测试目录：'+dir);
});

test('restart preserves pending codes and permanent sessions without extending finite login expiry',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rcm-phone-expiry-')),file=path.join(dir,'sessions.json');let now=1000;
  let access=new MobileAccess(file,()=>now);const code=access.createCode(600,86400).code;
  access=new MobileAccess(file,()=>now);const token=access.login(code),req={headers:{cookie:'rcm_mobile='+token}},expiry=access.expires(req);
  now+=3600000;access=new MobileAccess(file,()=>now);assert.ok(access.valid(req));assert.equal(access.expires(req),expiry);
  now=expiry;assert.equal(access.valid(req),false);
  const permanent=access.login(access.createCode(600,null).code),permanentReq={headers:{cookie:'rcm_mobile='+permanent}};
  now+=86400000*500;access=new MobileAccess(file,()=>now);assert.ok(access.valid(permanentReq));
  access.revoke();assert.equal(new MobileAccess(file,()=>now).valid(permanentReq),false);
  console.log('保留手机有效期测试目录：'+dir);
});
