import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MobileAccess} from '../lib/mobile-access.mjs';
const request=token=>({headers:{cookie:'rcm_mobile='+token}});
test('pair codes expire, are single-use, and sessions expire or revoke',()=>{let now=1000;const a=new MobileAccess(null,()=>now);const old=a.createCode();now+=3600001;assert.throws(()=>a.login(old.code));const code=a.createCode();const token=a.login(code.code);assert(a.valid(request(token)));assert.throws(()=>a.login(code.code));now+=7*86400000;assert(!a.valid(request(token)));const token2=a.login(a.createCode().code);a.revoke();assert(!a.valid(request(token2)));});
test('five invalid attempts throttle even a correct code; logout clears session',()=>{let now=0;const a=new MobileAccess(null,()=>now);const code=a.createCode().code;for(let i=0;i<5;i++)assert.throws(()=>a.login('wrong'));assert.throws(()=>a.login(code),e=>e.status===429);now=900001;const token=a.login(a.createCode().code);a.logout(request(token));assert(!a.valid(request(token)));assert.match(a.cookie(token),/HttpOnly; Secure; SameSite=Strict/);});

test('default one hour, explicit durations and permanent codes',()=>{let now=100;const a=new MobileAccess(null,()=>now);assert.equal(a.createCode().expires,3600100);assert.equal(a.createCode(600).expires,600100);assert.throws(()=>a.createCode(0),e=>e.status===400);assert.throws(()=>a.createCode('3600'),e=>e.status===400);const permanent=a.createCode(null);assert.equal(permanent.expires,null);now+=365*86400000;const token=a.login(permanent.code);assert(a.valid(request(token)));assert.throws(()=>a.login(permanent.code));const old=a.createCode(null);a.createCode();assert.throws(()=>a.login(old.code));});

test('permanent code persists across restart and consumption or revoke persists',async()=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'rcm-expiry-'));const file=join(dir,'sessions.json');
 try{const a=new MobileAccess(file);const code=a.createCode(null).code;const b=new MobileAccess(file);b.login(code);assert.throws(()=>new MobileAccess(file).login(code));const c=new MobileAccess(file);const revoked=c.createCode(null).code;c.revoke();assert.throws(()=>new MobileAccess(file).login(revoked));}finally{/* Keep the isolated temporary fixture for inspection. */}
});

test('login duration is bound to pairing code and permanent login survives restart and revocation',async()=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'rcm-login-'));const file=join(dir,'sessions.json');let now=1000;
 try{
  let a=new MobileAccess(file,()=>now);
  for(const ttl of [86400,604800,2592000]){const token=a.login(a.createCode(3600,ttl).code);assert.match(a.cookie(token),new RegExp('Max-Age='+ttl+'$'));now+=ttl*1000;assert(!a.valid(request(token)));}
  assert.throws(()=>a.createCode(3600,0),e=>e.status===400);assert.throws(()=>a.createCode(3600,'permanent'),e=>e.status===400);
  const code=a.createCode(3600,null).code;a=new MobileAccess(file,()=>now);const token=a.login(code);
  now+=5*365*86400000;a=new MobileAccess(file,()=>now);assert(a.valid(request(token)));assert.equal(a.expires(request(token)),null);assert.match(a.cookie(token),/Max-Age=34560000$/);assert(!a.valid(request('a'.repeat(64))));
  a.logout(request(token));assert(!new MobileAccess(file,()=>now).valid(request(token)));
  const second=a.login(a.createCode(3600,null).code);a.revoke();assert(!new MobileAccess(file,()=>now).valid(request(second)));
 }finally{/* Keep the isolated temporary fixture for inspection. */}
});
