import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
const marker='RCM_WORKBENCH_CHECK=';

// Use the same browser automation as manual acceptance, with a new, empty tab.
// The probe never clicks controls and rejects writes before they reach the server.
export function installReadOnlyProbe(){
 const probe=window.__rcmDeploymentProbe={errors:[]};
 window.addEventListener('error',event=>{
  const target=event.target;
  if(target?.tagName==='SCRIPT'||target?.tagName==='LINK')probe.errors.push('资源加载失败：'+(target.src||target.href));
  else if(event.message)probe.errors.push(event.message);
 },true);
 window.addEventListener('unhandledrejection',event=>probe.errors.push(String(event.reason?.message||event.reason)));
 const original=window.fetch;
 window.fetch=function(input,options){
  const method=String(options?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  // Presence can resume an automatically released thread. Simulate only its
  // acknowledgement during this read-only page-load probe; test the route separately.
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(method==='POST'&&url.pathname==='/api/thread-view')return Promise.resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));
  if(!['GET','HEAD'].includes(method))return Promise.reject(new Error('部署加载检查不执行写入请求。'));
  return original.call(this,input,options);
 };
}
export function assertWorkbenchResult(result,version){
 if(result?.version!==version)throw Error('工作台检查读到的版本与待部署版本不一致。');
 if(!result.ready)throw Error('工作台未完成初始化。');
 if(!Array.isArray(result.errors)||result.errors.length)throw Error('工作台加载出错：'+(result.errors?.join('；')||'没有有效的浏览器检查结果'));
 return result;
}
export async function prepareWorkbenchCheck({browser=process.env.RCM_EGO_BROWSER,run=execute}={}){
 if(!browser){const local=path.join(homedir(),'.local/bin/ego-browser');try{await access(local);browser=local;}catch{browser='ego-browser';}}
 const invoke=async source=>{
  const pending=run(browser,['nodejs','-e',source],{timeout:45000,maxBuffer:1024*1024});
  pending.child?.stdin?.end();
  const {stdout,stderr}=await pending;
  const line=(stdout+'\n'+(stderr||'')).split('\n').find(line=>line.startsWith(marker));
  if(!line)throw Error('浏览器没有返回有效的工作台检查结果。');
  return JSON.parse(line.slice(marker.length));
 };
 let id;
 try{
  const result=await invoke(`const task=await taskSpace(${JSON.stringify('RCM部署检查-'+randomUUID())});console.log(${JSON.stringify(marker)}+JSON.stringify({id:task.spaceId}));`);
  if(!Number.isInteger(result.id))throw Error('浏览器未返回检查空间。');id=result.id;
 }catch(error){throw Error('无法准备工作台浏览器检查，未重启网页。请确认 ego-browser 可用：'+error.message);}
 return {
  async check({version,host}){
   const url='http://127.0.0.1:4317/?host='+encodeURIComponent(host);
   const source=`
const task=await taskSpace(${id}),page=task.page('p1');
await page.cdp('Network.enable');
await page.cdp('Network.setCacheDisabled',{cacheDisabled:true});
await page.cdp('Network.setBypassServiceWorker',{bypass:true});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify('('+installReadOnlyProbe.toString()+')()')}});
let result;
try {
 await page.goto(${JSON.stringify(url)});
 await page.waitForFunction(()=>document.getElementById('startup-status')?.hidden===true&&!document.body.classList.contains('startup-pending'),undefined,{timeout:20000});
 result=await page.evaluate(async()=>{
  // Await the complete module evaluation, including code after rcm-ready.
  await Promise.race([import('/app.js'),new Promise((_,reject)=>setTimeout(()=>reject(Error('入口模块执行超时')),15000))]);
  const response=await fetch('/api/version',{cache:'no-store'});
  if(!response.ok)throw Error('版本接口不可用');
  const data=await response.json();
  const errors=[...(window.__rcmDeploymentProbe?.errors||['浏览器探针未启动'])];
  for(const entry of performance.getEntriesByType('resource'))if(['script','link','css'].includes(entry.initiatorType)&&entry.responseStatus>=400)errors.push('资源请求失败：'+entry.name);
  return {version:data.version,ready:document.getElementById('startup-status')?.hidden===true&&!document.body.classList.contains('startup-pending'),errors};
 });
} catch(error){result={ready:false,errors:[error.message]};}
console.log(${JSON.stringify(marker)}+JSON.stringify(result));`;
   const result=await invoke(source);
   if(!result.ready)throw Error('工作台浏览器加载检查失败：'+(result.errors||[]).join('；'));
   return assertWorkbenchResult(result,version);
  },
  async close(){await invoke(`const task=await taskSpace(${id});await task.finish({keep:[]});console.log(${JSON.stringify(marker)}+'{}');`);},
 };
}
