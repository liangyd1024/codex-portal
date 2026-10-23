import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('thread preferences survive history arriving before the model catalog',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function renderModels('),source.indexOf('\n}\n',source.indexOf('function renderModels('))+3);
 const state={models:[],model:'',effort:''};
 const ctx={newChatOpen:false,state,currentThread:()=>({model:'saved',reasoningEffort:'high'}),modelFor:id=>state.models.find(m=>m.model===id),modelId:m=>m.model,effortsFor:id=>state.models.find(m=>m.model===id)?.efforts||[],defaultEffort:()=> 'low',$:()=>({}),fillModels:()=>{},fillEfforts:()=>{},renderControls:()=>{}};
 vm.createContext(ctx);vm.runInContext(fn+';renderModels(true)',ctx);
 assert.equal(state.model,'saved');assert.equal(state.effort,'high');
 state.models=[{model:'default',isDefault:true,efforts:[{value:'low'}]},{model:'saved',efforts:[{value:'low'},{value:'high'}]}];
 vm.runInContext('renderModels()',ctx);
 assert.equal(state.model,'saved');assert.equal(state.effort,'high');
 state.effort='low';vm.runInContext('renderModels()',ctx);assert.equal(state.effort,'low');
});


test('sidebar snapshot restores projects and chats without filtering to the selected project',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const snapshot={accountScope:'test',projects:[{id:'one'},{id:'two'}],data:[{id:'a',projectId:'one'},{id:'b',projectId:'two'}]};
 const state={selectedId:null,projectId:'one',projects:[],listVersion:0,threads:[],search:''},requests=[];
 const ctx=vm.createContext({state,threadSearch:'',createdThreads:new Map(),URLSearchParams,
  loadProjects:async()=>{state.projects=snapshot.projects;},connected:()=>true,usable:()=>true,$:()=>({scrollTop:0}),renderThreads(){},renderControls(){},
  requestAnimationFrame(){},loadVisibleThreads(){},loadSidebarActivity(){},
  api:async url=>{requests.push(url);return snapshot;},recordError:e=>{throw e;},toast(){},messageOf:String});
 vm.runInContext(source.slice(source.indexOf('async function readThreads('),source.indexOf('async function loadSidebarActivity(')),ctx);
 await ctx.readThreads();
 assert.equal(requests.length,1);
 const url=new URL(requests[0],'http://test');assert.equal(url.pathname,'/api/sidebar');
 assert.equal(url.searchParams.has('cwd'),false);assert.equal(url.searchParams.has('projectId'),false);
 assert.deepEqual(state.projects,snapshot.projects);assert.deepEqual(Array.from(state.threads,t=>t.id),['a','b']);
});
