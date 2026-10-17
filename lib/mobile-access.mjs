import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const hash=s=>createHash('sha256').update(s).digest('hex');
export class MobileAccess {
 constructor(file,now=Date.now){this.file=file;this.now=now;this.sessions={};this.failures=[];this.code=null;try{this.sessions=JSON.parse(readFileSync(file,'utf8'));}catch{} try{if(file)this.code=JSON.parse(readFileSync(file+'.code','utf8'));}catch{} }
 save(){if(!this.file)return;mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});writeFileSync(this.file+'.tmp',JSON.stringify(this.sessions),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 saveCode(){if(!this.file)return;mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});writeFileSync(this.file+'.code.tmp',JSON.stringify(this.code),{mode:0o600});renameSync(this.file+'.code.tmp',this.file+'.code');}
 createCode(ttlSeconds=3600,sessionTtlSeconds=604800){if(sessionTtlSeconds!==null&&![86400,604800,2592000].includes(sessionTtlSeconds))throw Object.assign(new Error('请选择有效的手机登录有效期。'),{status:400});if(ttlSeconds!==null&&![600,3600,86400,604800].includes(ttlSeconds))throw Object.assign(new Error('请选择有效的配对码有效期。'),{status:400});const code=String(randomInt(100000,1000000));this.code={sessionTtlSeconds,hash:hash(code),expires:ttlSeconds===null?null:this.now()+ttlSeconds*1000};this.saveCode();return {code,expires:this.code.expires,sessionTtlSeconds};}
 login(code){this.failures=this.failures.filter(t=>t>this.now()-900000);if(this.failures.length>=5)throw Object.assign(new Error('尝试次数过多，请在 15 分钟后重试。'),{status:429});const input=hash(String(code));if(!this.code||(this.code.expires!==null&&this.code.expires<=this.now())||!timingSafeEqual(Buffer.from(input),Buffer.from(this.code.hash))){this.failures.push(this.now());throw Object.assign(new Error('配对码无效或已过期。'),{status:401});}const ttl=this.code.sessionTtlSeconds===undefined?604800:this.code.sessionTtlSeconds;this.code=null;this.saveCode();const token=randomBytes(32).toString('hex');this.sessions[hash(token)]=ttl===null?null:this.now()+ttl*1000;this.save();return token;}
 token(req){return /(?:^|;\s*)rcm_mobile=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1]||'';}
 expires(req){return this.sessions[hash(this.token(req))];}
 valid(req){const expiry=this.expires(req);return expiry===null||expiry>this.now();}
 logout(req){delete this.sessions[hash(this.token(req))];this.save();}
 revoke(){this.sessions={};this.code=null;this.saveCode();this.save();}
 cookie(token=''){const expiry=this.sessions[hash(token)];const age=!token?0:expiry===null?34560000:Math.max(0,Math.ceil((expiry-this.now())/1000));return `rcm_mobile=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;}
}
