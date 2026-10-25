import test from 'node:test';
import assert from 'node:assert/strict';
import {browseFolders,createFolder,openFolderProject} from '../src/server/services/project-folders.ts';
const key='b734c8aa-79f5-46ba-b3eb-bf61c6418f97';
function fixture(handler){
 const calls=[];const m={host:{home:'/target/home',alias:'目标'},service:{protocolValidation:{features:{projectFolders:{supported:true}}}},generation:1,projects:[],requireConnected(){if(!this.rpc.connected)throw Error('disconnected');},requireWritable(){this.requireConnected();},withMutation:fn=>fn(),publish(){},rpc:{connected:true,async request(method,params){calls.push({method,params});return handler?.(method,params)??(method==='fs/getMetadata'?{isDirectory:true}:method==='project/list'?{data:[]}:{entries:[]});}}};return {m,calls};
}
test('directory browse starts at configured target HOME and filters files and unsafe child names',async()=>{
 const {m,calls}=fixture(method=>method==='fs/readDirectory'?{entries:[{fileName:'中文 文件夹',isDirectory:true},{fileName:'file.txt',isFile:true},{fileName:'../other',isDirectory:true}]}:null);
 const result=await browseFolders(m);assert.equal(result.path,'/target/home');assert.deepEqual(result.entries,[{name:'中文 文件夹',path:'/target/home/中文 文件夹'}]);assert.equal(calls[0].params.path,'/target/home');assert.equal((await browseFolders(m,'/')).parent,null);
});
test('folder names cannot traverse, absolute paths required and parents are never created recursively',async()=>{
 const {m,calls}=fixture();
 for(const name of ['', '..','.', '../x','x/y','x\\y',' x','x\0'])await assert.rejects(createFolder(m,{parent:'/home',name}));
 await assert.rejects(createFolder(m,{parent:'relative',name:'x'}));assert.equal(calls.length,0);
 assert.deepEqual(await createFolder(m,{parent:'/target/home',name:'中文 新建'}),{path:'/target/home/中文 新建'});assert.deepEqual(calls.at(-1),{method:'fs/createDirectory',params:{path:'/target/home/中文 新建',recursive:false}});
});
test('existing root on later project page is reused without creating duplicate',async()=>{
 const {m,calls}=fixture((method,p)=>method==='project/list'?p.cursor?{data:[{id:'existing',name:'现有',roots:[{path:'/target/project'}]}]}:{data:[],nextCursor:'next'}:null);
 const result=await openFolderProject(m,{path:'/target/project/',idempotencyKey:key});assert.equal(result.existing,true);assert.equal(result.project.id,'existing');assert.equal(calls.some(c=>c.method==='project/create'),false);assert.deepEqual(m.projects,[result.project]);
});
test('new project passes original idempotency key and native roots; timeout is unknown, never replayed',async()=>{
 const {m,calls}=fixture((method,p)=>{if(method==='project/create')throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});});
 await assert.rejects(openFolderProject(m,{path:'/target/new',idempotencyKey:key}),{code:'OUTCOME_UNKNOWN'});assert.equal(calls.filter(c=>c.method==='project/create').length,1);assert.deepEqual(calls.at(-1).params,{idempotencyKey:key,name:'new',roots:[{path:'/target/new'}]});assert.deepEqual(m.projects,[]);assert.equal(m.projectFolderMutation,false);
});
test('unsupported methods, non-directory selections, mismatched replies and changed connections fail closed',async()=>{
 const a=fixture();a.m.service.protocolValidation.features={};await assert.rejects(browseFolders(a.m),{code:'FEATURE_UNAVAILABLE'});assert.equal(a.calls.length,0);
 const b=fixture(()=>({isDirectory:false}));await assert.rejects(openFolderProject(b.m,{path:'/file',idempotencyKey:key}),/不是文件夹/);assert.equal(b.calls.length,1);
 const c=fixture(method=>method==='project/create'?{project:{id:'wrong',roots:[{path:'/wrong'}]}}:null);await assert.rejects(openFolderProject(c.m,{path:'/new',idempotencyKey:key}),{code:'OUTCOME_UNKNOWN'});assert.deepEqual(c.m.projects,[]);
 const d=fixture(method=>{d.m.generation++;return {isDirectory:true};});await assert.rejects(createFolder(d.m,{parent:'/parent',name:'new'}),{code:'CONNECTION_CHANGED'});assert.equal(d.calls.length,1);
});
test('concurrent project mutations are blocked and lock clears on failure',async()=>{
 let release;const {m}=fixture(()=>new Promise(r=>{release=r;}));
 const first=createFolder(m,{parent:'/p',name:'x'});await assert.rejects(createFolder(m,{parent:'/p',name:'x'}),{code:'PROJECT_BUSY'});release({isDirectory:false});await assert.rejects(first);assert.equal(m.projectFolderMutation,false);
});
test('project and directory HTTP mutations retain target routing, Origin and CSRF protection',async()=>{
 const {EventEmitter}=await import('node:events');const {createApp}=await import('../server.mjs');
 const a=fixture(),b=fixture();for(const [id,f] of [['a',a],['b',b]]){Object.setPrototypeOf(f.m,EventEmitter.prototype);EventEmitter.call(f.m);Object.assign(f.m,{host:{id,home:'/'+id,alias:id},connection:{state:'connected'},status:()=>({}),disconnect(){}});}
 const {server}=await createApp({config:{machineId:'a',defaultConnection:'a',connections:[]},managers:new Map([['a',a.m],['b',b.m]])});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const read=await fetch(base+'/api/project-folders?host=b').then(r=>r.json());assert.equal(read.path,'/b');assert.equal(a.calls.length,0);
  const payload=JSON.stringify({parent:'/b',name:'new'});
  assert.equal((await fetch(base+'/api/project-folders?host=b',{method:'POST',body:payload})).status,403);
  const {token}=await fetch(base+'/api/csrf').then(r=>r.json());
  assert.equal((await fetch(base+'/api/project-folders?host=b',{method:'POST',headers:{'x-csrf-token':token,origin:'https://other.example'},body:payload})).status,403);
  const result=await fetch(base+'/api/project-folders?host=b',{method:'POST',headers:{'x-csrf-token':token},body:payload}).then(r=>r.json());assert.equal(result.path,'/b/new');assert.equal(a.calls.length,0);
  assert.equal((await fetch(base+'/api/projects/open?host=b',{method:'POST',body:'{}'})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
