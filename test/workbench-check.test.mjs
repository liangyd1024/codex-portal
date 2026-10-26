import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {prepareWorkbenchCheck,installReadOnlyProbe,assertWorkbenchResult} from '../lib/workbench-check.mjs';
const version='a'.repeat(40);

test('browser verdict rejects a healthy version endpoint with missing modules, startup failure or wrong version',()=>{
 assert.equal(assertWorkbenchResult({version,ready:true,errors:[]},version).ready,true);
 for(const result of [{version,ready:false,errors:[]},{version,ready:true,errors:['process-summary.js 404']},{version,ready:true,errors:['SyntaxError']},{version:'old',ready:true,errors:[]},{version,ready:true}])assert.throws(()=>assertWorkbenchResult(result,version));
});

test('deployment probe leaves real reads intact and prevents native mutations',async()=>{
 const listeners={},calls=[],window={addEventListener:(name,fn)=>listeners[name]=fn,fetch:async(...args)=>{calls.push(args);return 'real response';}};
 vm.runInNewContext('('+installReadOnlyProbe.toString()+')()',{window,Request,Response,URL,location:{href:"http://localhost/"}});
 assert.equal(await window.fetch('/api/connections'),'real response');
 for(const method of ['POST','PUT','PATCH','DELETE'])await assert.rejects(window.fetch('/api/connect',{method}),/不执行写入/);
 await assert.rejects(window.fetch(new Request('http://localhost/api/connect',{method:'POST'})),/不执行写入/);
 assert.equal((await window.fetch('/api/thread-view',{method:'POST',body:'{}'})).status,200);
 assert.equal(calls.length,1);
 listeners.error({target:{tagName:'SCRIPT',src:'/missing.js'}});
 listeners.unhandledrejection({reason:Error('runtime failed')});
 assert.equal(window.__rcmDeploymentProbe.errors.length,2);
});

function browserFixture({result={version,ready:true,errors:[]},waitError,unavailable=false}={}){
 const actions=[];
 const page={cdp:async(...args)=>actions.push(args),goto:async url=>actions.push(['goto',url]),waitForFunction:async()=>{if(waitError)throw Error(waitError);},evaluate:async()=>result};
 const task={spaceId:42,page:()=>page,finish:async()=>actions.push(['finish'])};
 const run=async(binary,args,options)=>{
  assert.equal(binary,'/browser');assert.equal(options.timeout,45000);
  if(unavailable)throw Error('browser offline');
  let stdout='';
  const context=vm.createContext({taskSpace:async()=>task,console:{log:line=>stdout+=line+'\n'}});
  await vm.runInContext('(async()=>{'+args[2]+'})()',context);
  return {stdout:'',stderr:stdout};
 };
 return {actions,run};
}

test('browser check uses actual page navigation, fresh resources and waits for initialization',async()=>{
 const f=browserFixture(),check=await prepareWorkbenchCheck({browser:'/browser',run:f.run});
 assert.equal((await check.check({version,host:'local'})).ready,true);
 assert.ok(f.actions.some(([method,params])=>method==='Network.setCacheDisabled'&&params.cacheDisabled));
 assert.ok(f.actions.some(([method,params])=>method==='Network.setBypassServiceWorker'&&params.bypass));
 assert.ok(f.actions.some(([method,url])=>method==='goto'&&url==='http://127.0.0.1:4317/?host=local'));
 await check.close();assert.equal(f.actions.at(-1)[0],'finish');
});

test('missing browser blocks preparation; stalled initialization and module errors reject deployment',async()=>{
 const offline=browserFixture({unavailable:true});await assert.rejects(prepareWorkbenchCheck({browser:'/browser',run:offline.run}),/未重启网页/);
 for(const options of [{waitError:'startup timeout'},{result:{version,ready:true,errors:['module 404']}}]){
  const f=browserFixture(options),check=await prepareWorkbenchCheck({browser:'/browser',run:f.run});
  await assert.rejects(check.check({version,host:'local'}),/工作台/);await check.close();
 }
});

test('installer rolls back a live web service when browser loading fails despite version health',async()=>{
 const source=(await readFile(new URL('../scripts/install-local.mjs',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'file:///source/scripts/install-local.mjs'");
 const calls=[],files=new Map();
 const context={
  process:{argv:['node','install'],getuid:()=>42,execPath:'/node',env:{}},
  path:(await import('node:path')).default,fileURLToPath:(await import('node:url')).fileURLToPath,
  homedir:()=>'/home/test',supportDir:'/support',loadConfig:()=>({connections:[{id:'local',kind:'local'}]}),
  launchdService:()=>({stop:async()=>calls.push('stop'),start:async()=>calls.push('start')}),
  deploymentLock:async()=>({release:async()=>calls.push('unlock')}),checkDeploymentEntrance:async()=>{},
  mkdir:async()=>{},chmod:async()=>{},stat:async()=>({}),writeFile:async(file,data)=>{files.set(file,data);},
  readFile:async file=>file.endsWith('VERSION')?version:'old plist',
  spawnSync:(_cmd,args)=>({status:0,stdout:args.includes('--porcelain')?'':args.includes('show')?'{}':version}),
  fetch:async()=>({ok:true,json:async()=>({version})}),
  prepareWorkbenchCheck:async()=>{calls.push('prepare');return {check:async()=>{calls.push('browser');throw Error('module 404');},close:async()=>calls.push('close')};},
  console:{log(){},error(){}},AbortSignal,setTimeout,
 };
 await assert.rejects(vm.runInNewContext('(async()=>{'+source+'})()',context),/部署失败，已恢复原网页配置：module 404/);
 assert.deepEqual(calls,['prepare','stop','start','browser','stop','start','close','unlock']);
 assert.equal(files.get('/home/test/Library/LaunchAgents/local.remote-codex-manager.web.plist'),'old plist');
 assert.equal(files.has('/support/installed.json'),false);
});

test('default deployment check uses HTTP and verifies actual asset bytes without a browser',async()=>{
 const {mkdtemp,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {createServer}=await import('node:http');
 const root=await mkdtemp(path.join(tmpdir(),'rcm-http-check-'));
 const html='<script src="/bootstrap.js"></script>';
 const files={'app.js':'export const ready=true;','bootstrap.js':'import("/app.js");','styles.css':'body{color:black}'};
 await writeFile(path.join(root,'index.html'),html);
 await writeFile(path.join(root,'turn-file-viewer.js'),'withdrawn route must not be requested');
 for(const [name,value] of Object.entries(files))await writeFile(path.join(root,name),value);
 let fault='';const methods=[];
 const server=createServer((req,res)=>{
  methods.push(req.method);
  if(req.url==='/api/version'){res.setHeader('content-type','application/json');res.end(JSON.stringify({version:fault==='version'?'old':version}));return;}
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(fault==='homepage'?'wrong page':html);return;}
  const name=req.url.slice(1);res.statusCode=fault==='missing'?404:200;
  res.setHeader('content-type',fault==='mime'?'text/html':name.endsWith('.css')?'text/css':'text/javascript');
  res.end(fault==='bytes'?'stale':files[name]);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const check=await prepareWorkbenchCheck({browser:'',staticRoot:root,baseUrl:'http://127.0.0.1:'+server.address().port,run:()=>{throw Error('must not run browser');}});
  const result=await check.check({version});assert.equal(result.assets,3);assert.equal(result.browserExecuted,false);
  for(fault of ['version','homepage','missing','mime','bytes'])await assert.rejects(check.check({version}));
  assert.ok(methods.every(method=>method==='GET'));await check.close();
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
