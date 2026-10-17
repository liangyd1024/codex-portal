import http from 'node:http';import https from 'node:https';import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync(path.join(homedir(),'Library/Application Support/RemoteCodexManager/mobile/config.json'),'utf8'));
const origin=config.origins.find(x=>process.argv.includes('--tailscale')?x.includes('.ts.net'):!x.includes('.ts.net')),ca=readFileSync(config.ca);
function request(url,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{const u=new URL(url);const req=(u.protocol==='https:'?https:http).request(u,{method,headers,...(!origin.includes('.ts.net')?{ca}:{})},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let json;try{json=JSON.parse(raw);}catch{}resolve({status:res.statusCode,headers:res.headers,json});});});req.on('error',reject);req.end(body&&JSON.stringify(body));});}
const csrf=(await request('http://127.0.0.1:4317/api/csrf')).json.token;
assert.equal((await request(origin+'/')).status,200);assert.equal((await request(origin+'/api/status')).status,401);
const code=(await request('http://127.0.0.1:4317/api/access/code',{method:'POST',headers:{'X-CSRF-Token':csrf},body:{}})).json.code;
const login=await request(origin+'/api/access/login',{method:'POST',headers:{Origin:origin},body:{code}});assert.equal(login.status,200);
const cookie=login.headers['set-cookie'][0].split(';')[0],headers={Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf};
assert.equal((await request(origin+'/api/status',{headers})).status,200);
assert.equal((await request(origin+'/api/access/logout',{method:'POST',headers,body:{}})).status,200);
assert.equal((await request(origin+'/api/status',{headers})).status,401);
console.log('PASS: trusted TLS, login page, unauthorized rejection, pairing, authenticated read, logout.');
