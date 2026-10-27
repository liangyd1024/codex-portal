// RFC 8291 single-record encryption and RFC 8292 VAPID, using Node crypto.
import {createECDH,createHmac,createCipheriv,createPrivateKey,sign,randomBytes,randomUUID} from 'node:crypto';
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
export function createPushKeys(){const e=createECDH('prime256v1');e.generateKeys();return {publicKey:e.getPublicKey().toString('base64url'),privateKey:e.getPrivateKey().toString('base64url')};}
export function validateSubscription(value){
 const fail=()=>{throw Object.assign(Error('推送订阅无效或推送服务不受支持。'),{status:400});};
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)fail();
 const u=new URL(value.endpoint);
 // Fixed browser-provider destinations prevent a subscription from becoming an SSRF proxy.
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!(/^(?:[a-z0-9-]+\.)*push\.apple\.com$/.test(u.hostname)||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'))fail();
 const keys=value.keys;if(!keys||typeof keys.p256dh!=='string'||typeof keys.auth!=='string')fail();
 const pub=Buffer.from(keys.p256dh,'base64url'),auth=Buffer.from(keys.auth,'base64url');
 if(pub.length!==65||pub[0]!==4||auth.length!==16)fail();
 try{const e=createECDH('prime256v1');e.generateKeys();e.computeSecret(pub);}catch{fail();}
 return {endpoint:u.href,keys:{p256dh:pub.toString('base64url'),auth:auth.toString('base64url')}};
}
export function encryptPush(subscription,payload,{privateKey,salt=randomBytes(16)}={}){
 const e=createECDH('prime256v1');if(privateKey)e.setPrivateKey(privateKey);else e.generateKeys();
 const ua=Buffer.from(subscription.keys.p256dh,'base64url'),pub=e.getPublicKey();
 const prk=hmac(Buffer.from(subscription.keys.auth,'base64url'),e.computeSecret(ua));
 const ikm=hmac(prk,Buffer.concat([Buffer.from('WebPush: info\0'),ua,pub,Buffer.from([1])]));
 const secret=hmac(salt,ikm),key=hmac(secret,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),nonce=hmac(secret,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12);
 const plain=Buffer.from(payload);if(plain.length>3993)throw Error('推送内容过长。');
 const cipher=createCipheriv('aes-128-gcm',key,nonce),header=Buffer.alloc(21);salt.copy(header);header.writeUInt32BE(4096,16);header[20]=65;
 return Buffer.concat([header,pub,cipher.update(Buffer.concat([plain,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
}
export function notificationPayload(payload,origin){
 const navigate=new URL(payload.data?.threadId?'/index.html':'/',origin);
 if(payload.data?.host)navigate.searchParams.set('host',payload.data.host);
 if(payload.data?.threadId){navigate.searchParams.set('thread',payload.data.threadId);navigate.searchParams.set('notification-click',payload.data.testId||randomUUID());}
 // Older WebKit reads mutable inside notification (webkit.org/b/297389).
 // Send both locations so both parsers dispatch push and preserve click routing.
 return {...payload,web_push:8030,mutable:true,notification:{mutable:true,title:payload.title,body:payload.body,tag:payload.tag,data:payload.data,navigate:navigate.href,silent:false}};
}
export async function sendPush(subscription,payload,keys,subject,fetcher=fetch,deliveryMode='declarative'){
 if(!['declarative','legacy'].includes(deliveryMode))throw Object.assign(Error('通知投递模式无效。'),{status:400});
 // A per-call diagnostic transport option; never inferred from payload fields.
 const legacy=deliveryMode==='legacy';
 const wirePayload=legacy?{title:payload.title,body:payload.body,tag:payload.tag,data:payload.data}:notificationPayload(payload,subject);
 const pub=Buffer.from(keys.publicKey,'base64url');
 const key=createPrivateKey({key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url'),d:keys.privateKey},format:'jwk'});
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const token=encode({typ:'JWT',alg:'ES256'})+'.'+encode({aud:new URL(subscription.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,...(subject?.startsWith('https:')?{sub:subject}:{})});
 const signature=sign('sha256',Buffer.from(token),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetcher(subscription.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`vapid t=${token}.${signature}, k=${keys.publicKey}`,'Content-Encoding':'aes128gcm','Content-Type':legacy?'application/octet-stream':'application/notification+json',TTL:'3600',Urgency:'normal'},body:encryptPush(subscription,JSON.stringify(wirePayload))});
 await response.body?.cancel();return response.status;
}
