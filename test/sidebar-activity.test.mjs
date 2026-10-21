import test from 'node:test';
import assert from 'node:assert/strict';
import {Sidebar,sidebarGroups} from '../public/sidebar.js';
test('section and project aggregate live sources, exclude moved pinned children, and clear on disconnect or completion',()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>({children:[],setAttribute(k,v){this[k]=v;},append(n){this.children.push(n);},replaceChildren(...nodes){this.children=nodes;}})};
 try{
  let connected=true;const sidebar=Object.create(Sidebar.prototype);sidebar.o={connected:()=>connected,icon:()=>({})};
  const web={id:'w',status:{type:'active'}},desktop={id:'d',activity:{state:'running',source:'desktop',observedAt:Date.now()}},stale={id:'x',activity:{state:'running',source:'desktop',observedAt:0}};
  const snapshot={data:[web,desktop,stale],projects:[{id:'p',threadIds:['w','d','x']}],sections:[{id:'s',projectIds:['p'],threadIds:[]}],pinnedThreadIds:['w'],pinnedProjectIds:[],rootProjectIds:[],rootThreadIds:[],preferences:{}};
  const both=document.createElement('span');sidebar.renderActivity(both,[{kind:'thread',value:web},{kind:'thread',value:desktop}]);assert.equal(both.children.length,1);assert.equal(both.children[0]['aria-label'],'2 个会话运行中（网页端 1，桌面端 1）');
  const groups=sidebarGroups(snapshot),section=groups.find(g=>g.id==='s');
  const badges=items=>{const n=document.createElement('span');sidebar.renderActivity(n,items);return n.children;};
  assert.equal(badges(groups[0].items)[0]['aria-label'],'1 个会话运行中（网页端 1）');
  assert.deepEqual(badges(section.items).map(n=>n['aria-label']),['1 个会话运行中（桌面端 1）']);
  assert.equal(badges(section.items[0].children).length,1);
  connected=false;assert.equal(badges(section.items).length,0);assert.equal(badges(groups[0].items).length,0);
  connected=true;desktop.activity.state='idle';web.status.type='idle';assert.equal(badges(section.items).length,0);
  sidebar.o.activitySource=t=>t.id==='x'?'web':null;assert.equal(badges(section.items)[0]['aria-label'],'1 个会话运行中（网页端 1）');
 }finally{globalThis.document=old;}
});
test('collapsed projects distinguish questions from running chats',()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>({children:[],setAttribute(k,v){this[k]=v;},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;}})};
 try{
 const s=Object.create(Sidebar.prototype);s.o={connected:()=>true,icon:()=>({}),needsAnswer:id=>id==='waiting'};
 const n=document.createElement('span');s.renderActivity(n,[{kind:'thread',value:{id:'waiting',status:{type:'active'}}},{kind:'thread',value:{id:'running',status:{type:'active'}}}]);
 assert.deepEqual(n.children.map(x=>x['aria-label']),['1 个会话需要你回答','1 个会话运行中（网页端 1）']);
 }finally{globalThis.document=old;}
});
