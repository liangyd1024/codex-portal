import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPreviewMobileSetup} from '../lib/preview-mobile.mjs';

async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'rcm-preview-mobile-test-'));
 const calls=[],listeners=[],secure={listening:false,setSecureContext(value){calls.push(['tls',value]);}};
 const proxy={listening:false,close(done){this.listening=false;calls.push(['close-proxy']);done();}};
 const app={proxyServer:proxy,createSecureServer(){calls.push(['create']);return secure;},async ready(){},setMobileConfig(config){this.config=config;}};
 const run=async(command,args)=>{
  calls.push([command,args]);
  for(const flag of ['-keyout','-out'])if(args.includes(flag))await writeFile(args[args.indexOf(flag)+1],flag==='-keyout'?'private-test-key':'test-certificate');
 };
 const listen=async(server,port,host)=>{listeners.push({port,host});server.listening=true;};
 return {directory,calls,listeners,secure,proxy,app,options:{directory,root:'/test/preview',app,run,listen,address:()=> '192.0.2.7',warn:()=>{}}};
}

test('preview mobile setup confines credentials and listeners, reuses certificates and keeps sessions',async()=>{
 const f=await fixture(),sessions=path.join(f.directory,'sessions.json');await writeFile(sessions,'existing-preview-sessions');
 const setup=createPreviewMobileSetup(f.options),first=await setup();
 assert.deepEqual(f.listeners,[{port:4338,host:'127.0.0.1'},{port:4339,host:'0.0.0.0'}]);
 assert.deepEqual(first.origins,['https://192.0.2.7:4339','https://127.0.0.1:4339']);
 for(const field of ['ca','key','cert'])assert.equal(path.dirname(first[field]),f.directory);
 const generated=f.calls.filter(([c,args])=>c==='/usr/bin/openssl'&&args.includes('-newkey')).length;
 assert.equal(generated,2);
 const next=await setup();assert.deepEqual(next,first);assert.equal(f.listeners.length,2);
 assert.equal(f.calls.filter(([c,args])=>c==='/usr/bin/openssl'&&args.includes('-newkey')).length,2);
 assert.equal(f.calls.filter(([c])=>c==='tls').length,1);
 assert.equal(await readFile(sessions,'utf8'),'existing-preview-sessions');
 assert.deepEqual(JSON.parse(await readFile(path.join(f.directory,'config.json'),'utf8')),next);
 assert.equal(f.calls.some(([c])=>c.includes('tailscale')),false);
});

test('preview rejects global forwarding and concurrent setup without side effects',async()=>{
 const f=await fixture();let release;
 const original=f.options.run;f.options.run=async(...args)=>{if(!release)await new Promise(resolve=>{release=resolve;});return original(...args);};
 const setup=createPreviewMobileSetup(f.options);
 await assert.rejects(setup('tailscale'),e=>e.status===409);assert.equal(f.calls.length,0);
 const first=setup();
 await assert.rejects(setup(),e=>e.status===409&&e.message.includes('正在配置'));
 while(!release)await new Promise(resolve=>setImmediate(resolve));release();await first;
});

test('failed HTTPS binding closes only the newly started preview proxy and allows retry',async()=>{
 const f=await fixture();let fail=true;
 const original=f.options.listen;f.options.listen=async(...args)=>{if(args[1]===4339&&fail)throw Error('test port occupied');return original(...args);};
 const setup=createPreviewMobileSetup(f.options);await assert.rejects(setup(),/test port occupied/);
 assert.equal(f.proxy.listening,false);assert.equal(f.app.config,undefined);
 fail=false;await setup();assert.equal(f.app.config.lanIP,'192.0.2.7');
});

test('LAN address changes renew only leaf credentials and update active TLS context',async()=>{
 const f=await fixture();let ip='192.0.2.7';f.options.address=()=>ip;
 const setup=createPreviewMobileSetup(f.options);await setup();ip='192.0.2.8';await setup();
 assert.equal(f.listeners.length,2);assert.equal(f.app.config.origins[0],'https://192.0.2.8:4339');
 assert.equal(f.calls.filter(([c,args])=>c==='/usr/bin/openssl'&&args.includes('-x509')).length,1);
 assert.equal(f.calls.filter(([c,args])=>c==='/usr/bin/openssl'&&args.includes('-newkey')).length,3);
});
