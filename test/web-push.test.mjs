import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,createHmac,createDecipheriv,createPublicKey,verify} from 'node:crypto';
import {createPushKeys,encryptPush,sendPush,validateSubscription} from '../lib/web-push.mjs';
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
function fixture(){const ua=createECDH('prime256v1');ua.generateKeys();return {ua,subscription:{endpoint:'https://web.push.apple.com/test',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,7).toString('base64url')}}};}
test('push payload decrypts on the user agent and VAPID signature matches public key',async()=>{
 const {ua,subscription}=fixture(),keys=createPushKeys();let request;
 const status=await sendPush(subscription,{title:'完成'},keys,'https://portal.example.com',async(url,options)=>{request=options;assert.equal(url,subscription.endpoint);return {status:201};});assert.equal(status,201);
 const wire=request.body,salt=wire.subarray(0,16),pub=wire.subarray(21,86);assert.equal(wire.readUInt32BE(16),4096);
 const prk=hmac(Buffer.from(subscription.keys.auth,'base64url'),ua.computeSecret(pub));
 const ikm=hmac(prk,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),pub,Buffer.from([1])]));
 const secret=hmac(salt,ikm),key=hmac(secret,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),nonce=hmac(secret,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12);
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(wire.subarray(-16));const plain=Buffer.concat([decipher.update(wire.subarray(86,-16)),decipher.final()]);assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(plain.subarray(0,-1)),{title:'完成'});
 const token=request.headers.Authorization.match(/t=([^,]+)/)[1],parts=token.split('.'),p=Buffer.from(keys.publicKey,'base64url');
 const publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:p.subarray(1,33).toString('base64url'),y:p.subarray(33).toString('base64url')},format:'jwk'});
 assert.ok(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://web.push.apple.com');assert.equal(request.redirect,'error');
});
test('subscriptions reject internal and untrusted URLs and malformed keys',()=>{const {subscription}=fixture();assert.deepEqual(validateSubscription(subscription),subscription);for(const endpoint of ['https://127.0.0.1/a','http://web.push.apple.com/a','https://push.apple.com.evil.test/a','https://web.push.apple.com:444/a','https://user@web.push.apple.com/a'])assert.throws(()=>validateSubscription({...subscription,endpoint}));assert.throws(()=>validateSubscription({...subscription,keys:{auth:'a',p256dh:'b'}}));});

test('a push wakes the worker and displays a notification without any open page',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const listeners=new Map(),shown=[];
 vm.runInNewContext(readFileSync(new URL('../public/notification-worker.js',import.meta.url),'utf8'),{self:{addEventListener:(name,handler)=>listeners.set(name,handler),registration:{showNotification:async(...args)=>shown.push(args)}}});
 let completion;listeners.get('push')({data:{json:()=>({title:'完成',body:'查看会话',tag:'one',data:{host:'fixture',threadId:'thread'}})},waitUntil:promise=>{completion=promise;}});await completion;
 assert.equal(shown.length,1);assert.equal(shown[0][0],'完成');assert.equal(shown[0][1].data.threadId,'thread');
});
