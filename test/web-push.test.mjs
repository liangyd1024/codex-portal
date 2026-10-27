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
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(wire.subarray(-16));const plain=Buffer.concat([decipher.update(wire.subarray(86,-16)),decipher.final()]);assert.equal(plain.at(-1),2);assert.equal(JSON.parse(plain.subarray(0,-1)).title,'完成');assert.equal(JSON.parse(plain.subarray(0,-1)).web_push,8030);assert.equal(JSON.parse(plain.subarray(0,-1)).mutable,true);assert.equal(JSON.parse(plain.subarray(0,-1)).notification.mutable,true);assert.equal(JSON.parse(plain.subarray(0,-1)).notification.navigate,'https://portal.example.com/');
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

// RFC 8291 section 5 public interoperability vector (not a private credential).
test('encryption exactly matches the RFC 8291 published wire example',()=>{
 const subscription={keys:{auth:'BTBZMqHH6r4Tts7J_aSIgg',p256dh:'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'}};
 const wire=encryptPush(subscription,'When I grow up, I want to be a watermelon',{privateKey:Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw','base64url'),salt:Buffer.from('DGv6ra1nlYgDCS1FRnbzlw','base64url')});
 assert.equal(wire.toString('base64url'),'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('worker confirms matching test only after display succeeds and reports display rejection',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 for(const fail of [false,true]){
  const handlers=new Map(),received=[];let completion;
  vm.runInNewContext(readFileSync(new URL('../public/notification-worker.js',import.meta.url),'utf8'),{self:{addEventListener:(name,handler)=>handlers.set(name,handler),registration:{showNotification:async()=>{if(fail)throw Error('display denied');}},clients:{matchAll:async()=>[{postMessage:message=>received.push(message)}]}}});
  handlers.get('push')({data:{json:()=>({web_push:8030,notification:{title:'test',data:{testId:'fixture-test-id'}}})},waitUntil:p=>{completion=p;}});
  if(fail)await assert.rejects(completion,/display denied/);else await completion;
  assert.equal(received[0].testId,'fixture-test-id');assert.equal(received[0].type,'rcm-push-receipt');assert.equal(received[0].error,fail?'Error: display denied':undefined);
 }
});

function decryptRequest(ua,subscription,request){
 const wire=request.body,salt=wire.subarray(0,16),pub=wire.subarray(21,21+wire[20]);
 const prk=hmac(Buffer.from(subscription.keys.auth,'base64url'),ua.computeSecret(pub));
 const ikm=hmac(prk,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),pub,Buffer.from([1])]));
 const secret=hmac(salt,ikm),key=hmac(secret,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),nonce=hmac(secret,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12);
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(wire.subarray(-16));
 const plain=Buffer.concat([decipher.update(wire.subarray(21+wire[20],-16)),decipher.final()]);assert.equal(plain.at(-1),2);
 return JSON.parse(plain.subarray(0,-1));
}
test('actual encrypted fetch bodies distinguish diagnostic transports and leave default declarative wire format unchanged',async()=>{
 const {ua,subscription}=fixture(),keys=createPushKeys(),requests=[];
 const payload={title:'测试',body:'目标正文',tag:'fixture',data:{host:'local',threadId:'other-thread',testId:'fixture-wire-test-001',diagnostic:true}};
 const fetcher=async(url,options)=>{assert.equal(url,subscription.endpoint);requests.push(options);return {status:201};};
 for(const mode of [undefined,'declarative','legacy'])await sendPush(subscription,payload,keys,'https://portal.example.com',fetcher,mode);
 const [normal,declarative,legacy]=requests.map(r=>decryptRequest(ua,subscription,r));
 assert.deepEqual(normal,declarative);assert.deepEqual(legacy,payload);
 assert.deepEqual(Object.keys(legacy).sort(),['body','data','tag','title']);
 for(const property of ['web_push','notification','mutable','navigate'])assert.equal(Object.hasOwn(legacy,property),false);
 assert.equal(declarative.web_push,8030);assert.equal(declarative.mutable,true);assert.equal(declarative.notification.mutable,true);
 assert.equal(declarative.notification.navigate,'https://portal.example.com/index.html?host=local&thread=other-thread&notification-click=fixture-wire-test-001');
 assert.equal(requests[0].headers['Content-Type'],'application/notification+json');assert.equal(requests[1].headers['Content-Type'],'application/notification+json');assert.equal(requests[2].headers['Content-Type'],'application/octet-stream');
 for(const request of requests){assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.equal(request.headers.TTL,'3600');assert.equal(request.redirect,'error');}
 // Changing the ordinary payload's metadata never selects the transport.
 await sendPush(subscription,{...payload,data:{...payload.data,deliveryMode:'legacy'}},keys,'https://portal.example.com',fetcher);
 assert.equal(decryptRequest(ua,subscription,requests.at(-1)).web_push,8030);
 await assert.rejects(sendPush(subscription,payload,keys,'https://portal.example.com',fetcher,'invalid'),e=>e.status===400);assert.equal(requests.length,4);
});
