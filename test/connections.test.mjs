import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {validateConfig,publicHost,pythonPrefix,shellWord} from '../lib/config.mjs';
import {createApp} from '../server.mjs';
import {Manager} from '../lib/manager.mjs';
import {validateBrowser} from '../public/browser-backup.js';
const sample=()=>({formatVersion:1,machineId:'a',defaultConnection:'local',connections:[{id:'local',machineId:'a',kind:'local',alias:'本机 A',home:'/Users/a',user:'a',binary:'/opt/codex'},{id:'custom-peer',machineId:'b',kind:'ssh',alias:'远端 B',home:'/Users/b',user:'b',binary:'/opt/custom codex',address:'peer.example',port:2200,identityFile:'/Users/a/.ssh/key'}]});
test('new connection IDs and configured binary/path work without personal constants',()=>{const c=validateConfig(sample(),{checkLocal:false});assert.equal(c.connections[1].dataDir,'/Users/b/.codex/remote-codex-manager');assert.match(pythonPrefix(c.connections[1]),/SERVICE_BINARY="\/opt\/custom codex"/);assert.equal(publicHost(c.connections[1]).identityFile,undefined);});
test('config rejects duplicate IDs, unsafe host, wrong local machine and version',()=>{for(const mutate of [c=>c.connections[1].id='local',c=>c.connections[1].address='host;echo bad',c=>c.connections[0].machineId='b',c=>c.formatVersion=99,c=>c.connections[1].port=0]){const c=sample();mutate(c);assert.throws(()=>validateConfig(c,{checkLocal:false}));}});
test('disconnect closes only this entrance and never invokes service release',()=>{let closed=0,killed=0,serviceCalls=0;const m=new Manager({host:sample().connections[0],remote:()=>{serviceCalls++;}});m.rpc={close(){closed++;}};m.tunnel={child:{kill(){killed++;}}};m.disconnect();assert.equal(closed,1);assert.equal(killed,1);assert.equal(serviceCalls,0);assert.equal(m.connection.state,'disconnected');});
test('service release requires explicit all-entrance confirmation',async()=>{const m=new Manager({host:sample().connections[0]});await assert.rejects(m.release(),e=>e.code==='MAINTENANCE_CONFIRMATION_REQUIRED');});
class Fake extends EventEmitter{constructor(host){super();this.host=host;this.connection={state:'disconnected'};}status(){return {host:this.host,connection:this.connection};}disconnect(){return this.status();}}
test('HTTP routing separates configurable hosts, hides SSH identity, and rejects unknown hosts',async()=>{
 const config=validateConfig(sample(),{checkLocal:false}),managers=new Map(config.connections.map(h=>[h.id,new Fake(h)]));const {server}=await createApp({config,managers});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const list=await fetch(base+'/api/connections?host=obsolete').then(r=>r.json());assert.equal(list.machineId,'a');assert.deepEqual(list.data.map(c=>c.id),['local','custom-peer']);assert.equal(list.data[1].host.identityFile,undefined);
  for(const id of ['local','custom-peer']){const s=await fetch(base+'/api/status?host='+id).then(r=>r.json());assert.equal(s.host.id,id);}
  assert.equal((await fetch(base+'/api/status?host=unknown')).status,404);
  assert.equal((await fetch(base+'/api/disconnect',{method:'POST',body:'{}'})).status,403);
  const token=await fetch(base+'/api/csrf').then(r=>r.json());assert.equal((await fetch(base+'/api/disconnect?host=custom-peer',{method:'POST',headers:{'x-csrf-token':token.token},body:'{}'})).status,200);
  assert.equal((await fetch(base+'/api/status',{headers:{origin:'https://evil.example'}})).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('browser import checks machine identity, target mapping and app-only keys',()=>{
 const config={machineId:'a',data:sample().connections.map(host=>({id:host.id,host}))};const data={format:'rcm-browser',version:1,machineId:'a',connections:config.data.map(({id,host:h})=>({id,machineId:h.machineId,home:h.home,user:h.user})).sort((a,b)=>a.id.localeCompare(b.id)),localStorage:{'rcm.connection':'local'},sessionStorage:{'rcm.drafts.local':'[]'},cache:{database:'rcm.recovery.v2',rows:[]}};
 assert.equal(validateBrowser(data,config),data);
 for(const mutate of [d=>d.machineId='b',d=>d.connections[0].home='/Users/wrong',d=>d.localStorage.cookie='bad',d=>d.cache.database='other',d=>d.version=99]){const d=structuredClone(data);mutate(d);assert.throws(()=>validateBrowser(d,config));}
});
test('unload delay is scoped to a connection and rejects invalid values',()=>{
 const c=sample();c.connections[0].threadUnloadDelaySecs=5;validateConfig(c,{checkLocal:false});
 assert.match(pythonPrefix(c.connections[0]),/SERVICE_THREAD_UNLOAD_DELAY_SECS=5\n/);
 assert.match(pythonPrefix(c.connections[1]),/SERVICE_THREAD_UNLOAD_DELAY_SECS=None\n/);
 for(const value of [-1,1.5,86401,'5',NaN]){const bad=sample();bad.connections[0].threadUnloadDelaySecs=value;assert.throws(()=>validateConfig(bad,{checkLocal:false}));}
});

test('Python path is configured and shell quoting does not expand metacharacters',async()=>{
 const c=sample();c.connections[1].python="/opt/custom python/bin/python3";
 assert.equal(validateConfig(c,{checkLocal:false}).connections[1].python,c.connections[1].python);
 assert.match(pythonPrefix(c.connections[1]),/SERVICE_PYTHON="\/opt\/custom python\/bin\/python3"/);
 c.connections[1].python='relative';assert.throws(()=>validateConfig(c,{checkLocal:false}),/Python 路径/);
 const value="/tmp/a'b $(printf injected)";
 const {execFileSync}=await import('node:child_process');
 assert.equal(execFileSync('/bin/sh',['-c',"printf '%s' "+shellWord(value)],{encoding:'utf8'}),value);
});

test('local transport and file reader execute the configured interpreter',async()=>{
 const {mkdtemp,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const path=await import('node:path');
 const {localPython}=await import('../lib/local.mjs');
 const {runFileReader}=await import('../lib/file-transfer.mjs');
 const directory=await mkdtemp(path.join(tmpdir(),'rcm-python-'));
 const python=path.join(directory,'custom interpreter');
 // A fake interpreter makes fallback to the system Python observable.
 await writeFile(python,'#!/bin/sh\ncat >/dev/null\nprintf \'RCM_JSON:{"selected":true}\\n\'\n',{mode:0o700});
 const host={...sample().connections[0],python};
 assert.deepEqual(await localPython(host,'ignored'),{selected:true});
 await writeFile(python,'#!/bin/sh\ncat >/dev/null\nprintf \'{"ok":true}\\npayload\'\n',{mode:0o700});
 const {meta,body}=await runFileReader(host,'ignored');
 assert.equal(meta.ok,true);let content='';for await(const chunk of body)content+=chunk;
 assert.equal(content,'payload');
});
