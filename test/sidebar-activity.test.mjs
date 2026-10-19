import test from 'node:test';
import assert from 'node:assert/strict';
import {Sidebar,sidebarGroups} from '../public/sidebar.js';
test('section and project aggregate live sources, exclude moved pinned children, and clear on disconnect or completion',()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>({children:[],setAttribute(k,v){this[k]=v;},append(n){this.children.push(n);}})};
 try{
  let connected=true;const sidebar=Object.create(Sidebar.prototype);sidebar.o={connected:()=>connected,icon:()=>({})};
  const web={id:'w',status:{type:'active'}},desktop={id:'d',activity:{state:'running',source:'desktop',observedAt:Date.now()}},stale={id:'x',activity:{state:'running',source:'desktop',observedAt:0}};
  const snapshot={data:[web,desktop,stale],projects:[{id:'p',threadIds:['w','d','x']}],sections:[{id:'s',projectIds:['p'],threadIds:[]}],pinnedThreadIds:['w'],pinnedProjectIds:[],rootProjectIds:[],rootThreadIds:[],preferences:{}};
  const groups=sidebarGroups(snapshot),section=groups.find(g=>g.id==='s');
  const badges=items=>{const n=document.createElement('span');sidebar.renderActivity(n,items);return n.children;};
  assert.equal(badges(groups[0].items)[0]['aria-label'],'1 个会话在网页端运行中');
  assert.deepEqual(badges(section.items).map(n=>n['aria-label']),['1 个会话在桌面端运行中']);
  assert.equal(badges(section.items[0].children).length,1);
  connected=false;assert.equal(badges(section.items).length,0);assert.equal(badges(groups[0].items).length,0);
  connected=true;desktop.activity.state='idle';web.status.type='idle';assert.equal(badges(section.items).length,0);
  sidebar.o.activitySource=t=>t.id==='x'?'web':null;assert.equal(badges(section.items)[0]['aria-label'],'1 个会话在网页端运行中');
 }finally{globalThis.document=old;}
});
