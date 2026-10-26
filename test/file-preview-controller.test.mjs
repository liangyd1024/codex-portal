import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilePreview} from '../src/web/services/file-preview.ts';
function fixture(t,read){
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 const make=tag=>({tag,children:[],events:{},paused:0,loads:0,setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(k,fn){this.events[k]=fn;},pause(){this.paused++;},load(){this.loads++;},append(n){this.children.push(n);},replaceChildren(){this.children=[];},querySelectorAll(){return this.children.filter(n=>['video','audio'].includes(n.tag));}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:make}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
 t.mock.method(globalThis,'fetch',read);
 const content=make('div'),view={},updates=[];
 const controller=createFilePreview({content,label:'test',url:mode=>mode,publish:patch=>{updates.push(patch);Object.assign(view,patch);}});
 return {content,view,updates,controller};
}
const json=data=>new Response(JSON.stringify(data));
test('closing a preview aborts its read and ignores late metadata',async t=>{
 let finish,signal;const f=fixture(t,(_url,options)=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
 const loading=f.controller.load();f.controller.close();const count=f.updates.length;
 finish(json({name:'sample.txt',size:20,kind:'text'}));await loading;
 assert.equal(signal.aborted,true);assert.equal(f.updates.length,count);assert.equal(f.content.children.length,0);
});
test('retry disposes media before replacing it; old events cannot change the new read',async t=>{
 const f=fixture(t,async()=>json({name:'sample.mp4',size:2000,kind:'video'}));
 await f.controller.load();const first=f.content.children[0];assert.equal(first.controls,true);assert.equal(first.playsinline,'');
 first.events.waiting();assert.match(f.view.status,/正在缓冲/);
 first.events.stalled();assert.equal(f.view.retryHidden,false);
 await f.controller.load();assert.equal(first.paused,1);assert.equal(first.loads,1);assert.equal(first.src,undefined);
 const status=f.view.status;first.events.error();assert.equal(f.view.status,status);assert.equal(f.view.retryHidden,true);
 const current=f.content.children[0];f.controller.close();assert.equal(current.paused,1);assert.equal(current.loads,1);assert.equal(f.content.children.length,0);
});
test('text response keeps complete preview bytes and truncation notice; failures remain retryable',async t=>{
 let fail=false;const f=fixture(t,async mode=>{if(fail)throw Error('offline');return mode==='meta'?json({name:'sample.txt',size:1048577,kind:'text'}):json({text:'原始\n正文\t<code>',truncated:true});});
 await f.controller.load();assert.equal(f.content.children[0].textContent,'原始\n正文\t<code>');assert.equal(f.content.children[0].tabIndex,0);assert.match(f.view.status,/仅预览前 1 MiB/);
 fail=true;await f.controller.load();assert.equal(f.view.retryHidden,false);
 assert.equal(f.view.status,'offline');assert.equal(f.content.children.length,0);
});

test('permanent file errors hide retry while connection and unsaved-message errors can retry',async t=>{
 let status=422,retryable=false;
 const f=fixture(t,async()=>new Response(JSON.stringify({error:{message:'文件夹不能预览',retryable}}),{status}));
 await f.controller.load();assert.equal(f.view.retryHidden,true);assert.equal(f.view.downloadHidden,true);
 status=404;retryable=true;await f.controller.load();assert.equal(f.view.retryHidden,false);
 status=503;await f.controller.load();assert.equal(f.view.retryHidden,false);
 f.controller.close();const count=f.updates.length;await f.controller.load();assert.equal(f.updates.length,count);
});

test('a failed text read keeps download available and honors nonretryable errors',async t=>{
 const f=fixture(t,async mode=>mode==='meta'?json({name:'sample.txt',size:20,kind:'text'}):new Response(JSON.stringify({error:{message:'文件已移动',retryable:false}}),{status:404}));
 await f.controller.load();assert.equal(f.view.downloadHidden,false);assert.equal(f.view.retryHidden,true);assert.equal(f.view.status,'文件已移动');
});

test('verified HTML exposes a separate browser view without executing or refetching source',async t=>{
 let html=true;const calls=[];
 const f=fixture(t,async mode=>{calls.push(mode);return mode==='meta'?json({name:html?'page.HTML':'sample.txt',size:50,kind:'text',htmlPreview:html}):json({text:'<script>throw Error("source must remain inert")</script>'});});
 await f.controller.load();assert.deepEqual(calls,['meta','text']);assert.equal(f.view.externalHidden,false);assert.equal(f.view.externalMode,'html');assert.match(f.content.children[0].textContent,/<script>/);assert.match(f.view.status,/仅加载内嵌资源/);
 html=false;await f.controller.load();assert.equal(f.view.externalHidden,true);assert.equal(f.view.externalMode,'content');
});
