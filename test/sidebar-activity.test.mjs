import test from 'node:test';
import assert from 'node:assert/strict';
import {Sidebar,sidebarGroups} from '../public/sidebar.js';
import {activitySummary,treePresentation} from '../src/web/services/sidebar-tree.ts';
test('section and project aggregate live sources, exclude moved pinned children, and clear on disconnect or completion',()=>{
 let connected=true;const sidebar=Object.create(Sidebar.prototype);sidebar.o={connected:()=>connected};
 const web={id:'w',status:{type:'active'}},desktop={id:'d',activity:{state:'running',source:'desktop',observedAt:Date.now()}},stale={id:'x',activity:{state:'running',source:'desktop',observedAt:0}};
 const snapshot={data:[web,desktop,stale],projects:[{id:'p',threadIds:['w','d','x']}],sections:[{id:'s',projectIds:['p'],threadIds:[]}],pinnedThreadIds:['w'],pinnedProjectIds:[],rootProjectIds:[],rootThreadIds:[],preferences:{}};
 const badges=items=>activitySummary(items,t=>sidebar.source(t));
 assert.deepEqual(badges([{kind:'thread',value:web},{kind:'thread',value:desktop}]).map(b=>b.title),['2 个会话运行中（网页端 1，桌面端 1）']);
 const groups=sidebarGroups(snapshot),section=groups.find(g=>g.id==='s');
 assert.equal(badges(groups[0].items)[0].title,'1 个会话运行中（网页端 1）');
 assert.deepEqual(badges(section.items).map(b=>b.title),['1 个会话运行中（桌面端 1）']);
 assert.equal(badges(section.items[0].children).length,1);
 connected=false;assert.equal(badges(section.items).length,0);assert.equal(badges(groups[0].items).length,0);
 connected=true;desktop.activity.state='idle';web.status.type='idle';assert.equal(badges(section.items).length,0);
 sidebar.o.activitySource=t=>t.id==='x'?'web':null;assert.equal(badges(section.items)[0].title,'1 个会话运行中（网页端 1）');
});
test('collapsed projects distinguish questions from running chats',()=>{
 const s=Object.create(Sidebar.prototype);s.o={connected:()=>true,needsAnswer:id=>id==='waiting'};
 const badges=activitySummary([{kind:'thread',value:{id:'waiting',status:{type:'active'}}},{kind:'thread',value:{id:'running',status:{type:'active'}}}],t=>s.source(t),s.o.needsAnswer);
 assert.deepEqual(badges.map(b=>b.title),['1 个会话需要你回答','1 个会话运行中（网页端 1）']);
 assert.deepEqual(badges.map(b=>[b.icon,b.count]),[['question',1],[undefined,1]]);
});
function presentationFixture(){
 const raw={id:'t',name:'原文',isPinned:true,isUnread:true,originator:'Codex Desktop',recencyAt:8,updatedAt:4,unknown:{full:'untouched'}};
 const c={view:{},snapshot:{archived:false,preferences:{pinned:'manual'},capabilities:{reorderThread:{supported:true}}},isExpanded:()=>true,source:()=> 'web',threadMenu:()=>[{label:'操作'}],sectionMenu:()=>[{label:'操作'}],o:{selectedId:()=>raw.id,connected:()=>true,threadName:t=>t.name,relativeTime:n=>'time:'+n,needsAnswer:()=>false}};
 const groups=[{id:'s',name:'分区',section:{id:'s'},items:[{kind:'thread',value:raw}]}];return {raw,c,groups};
}
test('tree keeps complete raw thread identity while capturing presentation and source independently',()=>{
 const {raw,c,groups}=presentationFixture(),view=treePresentation(groups,c)[0].items[0];
 assert.equal(view.raw,raw);assert.deepEqual(view.raw.unknown,{full:'untouched'});assert.equal(view.time,'time:8');assert.equal(view.draggable,true);assert.equal(view.selected,true);assert.equal(view.unread,true);
 assert.equal(view.badge.title,'桌面端创建 · 网页端正在运行');assert.equal(view.badge.icon,'globe');
 c.source=()=>null;c.o.needsAnswer=()=>true;assert.equal(view.badge.title,'桌面端创建 · 网页端正在运行');
 assert.equal(treePresentation(groups,c)[0].items[0].badge.title,'需要你回答');
 c.snapshot.archived=true;assert.equal(treePresentation(groups,c)[0].items[0].draggable,false);
});
test('search omits empty projects and empty sections, retaining custom empty groups outside search',()=>{
 const {c}=presentationFixture(),groups=[{id:'empty',name:'空分区',section:{id:'empty'},items:[]},{id:'projects',name:'项目',items:[{kind:'project',value:{id:'p',name:'空项目',roots:[]},children:[]}]}];
 assert.equal(treePresentation(groups,c).length,2);assert.equal(treePresentation(groups,c)[1].items[0].createDisabled,true);
 c.view.search='测试';assert.deepEqual(treePresentation(groups,c),[]);
});
