import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/request-renderer.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {createRequestRenderer}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
function fixture(requests){
 const calls=[],drafts=new Map(),main={},sideHost={},state={selectedId:'main',requestSignature:'',threads:[{id:'side',name:'侧会话'}]},sidebar={};let side={id:'side',requestsHost:sideHost},cards=[],views=[];
 const get=r=>drafts.get(r)||{};
 const deps={state,sidebar,sideChat:()=>side,requests:()=>requests,questionDrafts:{get,set:(r,patch)=>drafts.set(r,{...get(r),...patch})},document:{querySelectorAll:()=>cards},element:()=>main,renderControls:()=>calls.push('controls'),renderThreads:()=>calls.push('threads'),notifyTaskEvent:(method,r)=>calls.push(['notify',method,r]),requestThread:r=>r.threadId||r.params?.threadId,requestPath:r=>String(r.key??r.id),currentThread:()=>({id:'main',name:'主会话'}),threadName:t=>t.name,pretty:JSON.stringify,respondRequest:(r,answer)=>calls.push(['respond',r,answer]),publishRequestCards:next=>{views=next;calls.push('publish');}};
 return {render:createRequestRenderer(deps),state,sidebar,calls,drafts,main,sideHost,get views(){return views;},setSide:v=>{side=v;},setCards:v=>{cards=v;}};
}
test('unchanged requests preserve mounted cards; sent questions are filtered before notification',()=>{
 const a={id:'a',threadId:'main',params:{questions:[{id:'q'}]}},sent={id:'sent',params:{questions:[{id:'q'}]}},f=fixture([a,sent]);f.drafts.set(sent,{sent:true});f.render();const views=f.views;
 assert.deepEqual(f.calls,[['notify','manager/request',a],'threads','publish','controls']);assert.equal(views.length,1);
 f.calls.length=0;f.render();assert.deepEqual(f.calls,['controls']);assert.equal(f.views,views);
 f.setSide(null);f.render();assert.notEqual(f.views,views);
});
test('main and side routing retains raw request details and prior fields without leaking unrelated cards',()=>{
 const main={id:7,key:'opaque /?中文',threadId:'main',method:'item/commandExecution/requestApproval',params:{command:'fixture',future:{raw:['<原样>',null]},changes:[{path:null},{path:42}],availableDecisions:['acceptForSession']}},side={id:'side-question',params:{threadId:'side',questions:[{id:'s'}]}},other={id:'other',threadId:'elsewhere',params:{questions:[{id:'z'}]}},global={id:'global',method:'future/tool',params:{opaque:true}},f=fixture([main,side,other,global]);
 f.setCards([{dataset:{requestId:main.key},querySelectorAll:()=>[{name:'q-0',value:'one',checked:true},{name:'other-0',value:'草稿'}],querySelector:()=>({})}]);f.render();
 assert.equal(f.views.length,3);const [a,b,c]=f.views;assert.equal(a.host,f.main);assert.equal(b.host,f.sideHost);assert.equal(c.host,f.main);assert.equal(a.title,'命令执行审批');assert.equal(a.origin,'会话：主会话');assert.deepEqual(JSON.parse(a.detail),{method:main.method,params:main.params});assert.deepEqual(a.changes,[{path:''},{path:'42'}]);assert.equal(a.availableDecisions,main.params.availableDecisions);assert.deepEqual(a.previous,{fields:[{name:'q-0',value:'one',checked:true},{name:'other-0',value:'草稿',checked:undefined}],open:true});assert.equal(c.knownApproval,false);
 const answer={decision:'acceptForSession'};a.respond(answer);assert.equal(f.calls.at(-1)[1],main);assert.equal(f.calls.at(-1)[2],answer);
 assert.ok(f.calls.some(x=>Array.isArray(x)&&x[0]==='notify'&&x[2]===other));
});
test('question callbacks keep request identity and restoring a skipped question invalidates the projection',()=>{
 const r={id:'q',kind:'asyncQuestion',threadId:'side',params:{questions:[{id:'text'}],turnId:'turn',future:{nested:true}}},f=fixture([r]);f.drafts.set(r,{skipped:true,collapsed:true,fields:{text:{text:'保留答案'}}});f.render();const before=f.views[0];assert.equal(before.question.request,r);assert.equal(before.question.skipped,true);
 const answer={answers:{text:{answers:['完整原文']}}};before.question.options.submit(answer);assert.equal(f.calls.at(-1)[1],r);assert.equal(f.calls.at(-1)[2],answer);
 before.question.restore();assert.equal(f.views[0].question.skipped,false);assert.deepEqual(f.drafts.get(r),{skipped:false,collapsed:false,fields:{text:{text:'保留答案'}}});
 const previous=f.views;f.render();assert.equal(f.views,previous);before.question.options.rerender();assert.notEqual(f.views,previous);
});
test('sidebar interaction blocks its refresh while card clearing and control updates still run',()=>{
 const requests=[{id:'a',threadId:'main',kind:'approval'}],f=fixture(requests);f.sidebar.menu={};f.render();assert.deepEqual(f.calls,['publish','controls']);assert.equal(f.views.length,1);
 f.calls.length=0;requests.length=0;f.render();assert.deepEqual(f.calls,['publish','controls']);assert.deepEqual(f.views,[]);
 f.calls.length=0;f.render();assert.deepEqual(f.calls,['controls']);
});
