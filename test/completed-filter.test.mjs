import test from 'node:test';
import assert from 'node:assert/strict';
import {completedThreads} from '../src/web/services/completed-filter.ts';
import {RunningFilter} from '../src/web/services/running-filter.ts';
import {Sidebar} from '../src/web/services/sidebar.ts';
const source=t=>t.status==='active'?'web':null,waiting=t=>!!t.question;
const snapshot=data=>({accountScope:'account',data,activityPhase:'ready',preferences:{},projects:[],sections:[],rootProjectIds:[],rootThreadIds:data.map(t=>t.id),pinnedProjectIds:[],pinnedThreadIds:[]});
test('completed view lists only unseen successful receipts, preserving raw identity and order',()=>{
 const a={id:'a',projectId:'p',completionUnseen:true},b={id:'b',projectId:'q',completionUnseen:true};
 const data=[a,{id:'read',completionUnseen:false},{id:'active',completionUnseen:true,status:'active'},{id:'question',completionUnseen:true,question:true},{id:'archived',completionUnseen:true,archived:true},b];
 const s=snapshot(data);assert.deepEqual(completedThreads(s,source,waiting),[a,b]);assert.equal(completedThreads(s,source,waiting)[0],a);
 assert.deepEqual(completedThreads({...s,archived:true},source,waiting),[]);
 a.completionUnseen=false;assert.deepEqual(completedThreads(s,source,waiting),[b]);
});
function controller(){
 const c=Object.create(Sidebar.prototype),parent={scrollTop:123};
 Object.assign(c,{completed:false,running:false,snapshot:snapshot([{id:'done',completionUnseen:true}]),scope:'account',view:{search:'中文'},expanded:new Set(['project:p']),searchOverrides:new Map(),runningFilter:new RunningFilter(),node:{parentElement:parent,querySelectorAll:()=>[]},toolbar:{querySelector:()=>({focus:()=>{}})},closeMenu:()=>{},setBusy:()=>{},o:{connected:()=>true,relativeTime:()=>'',selectedId:()=>null},source,waiting});
 return {c,parent};
}
test('all/running/completed switches preserve original scroll and expansion; entering completed does not mark read',()=>{
 const {c,parent}=controller();let renders=0;c.render=()=>renders++;
 c.toggleView('completed');assert.equal(c.completed,true);assert.equal(c.running,false);assert.equal(parent.scrollTop,0);assert.equal(c.snapshot.data[0].completionUnseen,true);
 c.toggleView('completed');assert.equal(renders,1);
 c.toggleRunning(true);assert.equal(c.completed,false);assert.equal(c.running,true);
 c.toggleView('completed');c.toggleRunning(false);assert.equal(c.completed,false);assert.equal(c.running,false);assert.equal(parent.scrollTop,123);assert.deepEqual([...c.expanded],['project:p']);assert.equal(c.view.search,'中文');
 c.snapshot.data=[];c.toggleView('completed');assert.equal(c.completed,false);
});
test('viewed rows leave the completion list; last removal hides the entry and returns to all',()=>{
 const {c,parent}=controller();let rendered,toolbar;
 c.view={};c.toolbarView={setCompleted:v=>toolbar=v,setArchived:()=>{},setRunning:()=>{}};c.treeView={render:groups=>rendered=groups};
 const oldDocument=globalThis.document;globalThis.document={activeElement:null,body:{}};
 try{
  c.snapshot.data.push({id:'second',completionUnseen:true});c.snapshot.rootThreadIds.push('second');
  c.toggleView('completed');assert.equal(rendered[0].id,'completed');assert.equal(toolbar.count,2);
  c.snapshot.data[0].completionUnseen=false;c.render(c.snapshot,{});assert.equal(c.completed,true);assert.deepEqual(rendered[0].items.map(i=>i.value.id),['second']);assert.equal(toolbar.count,1);
  c.snapshot.data[1].completionUnseen=false;c.render(c.snapshot,{});assert.equal(c.completed,false);assert.deepEqual(toolbar,{active:false,count:0});assert.notEqual(rendered[0]?.id,'completed');assert.equal(parent.scrollTop,123);
  c.render(null,{});assert.deepEqual(toolbar,{active:false,count:0});
 }finally{globalThis.document=oldDocument;}
});
