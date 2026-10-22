import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarGroups,projectFolderOptions,Sidebar} from '../public/sidebar.js';
const fixture=()=>({data:[{id:'web-chat',projectId:'web',updatedAt:2},{id:'desktop-chat',projectId:'desktop',updatedAt:1}],projects:[{id:'web',name:'Project',roots:['/same/'],threadIds:['web-chat']},{id:'desktop',legacyId:'legacy',name:'Project',roots:['/same'],threadIds:['desktop-chat']}],sections:[{id:'tools',desktopId:'tools',name:'Tools',projectIds:['desktop'],threadIds:[],itemOrder:['project:desktop']}],rootProjectIds:['web'],pinnedProjectIds:[],pinnedThreadIds:[],rootThreadIds:[],preferences:{grouping:'project'}});
test('same roots render once in the desktop section with every chat and unchanged native IDs',()=>{
 const s=fixture(),before=structuredClone(s),groups=sidebarGroups(s),items=groups.flatMap(g=>g.items);
 assert.equal(items.length,1);assert.equal(items[0].value.id,'desktop');assert.equal(groups[0].id,'tools');
 assert.deepEqual(items[0].children.map(i=>i.value.id),['web-chat','desktop-chat']);assert.equal(items[0].children[0].value.projectId,'web');assert.deepEqual(s,before);
 const expanded=new Set();Sidebar.prototype.expandProject.call({snapshot:s,expanded,save(){}},'web');assert.ok(expanded.has('project:desktop'));assert.ok(expanded.has('section:tools'));
});
test('different roots, partial multi-root matches and empty roots remain separate',()=>{
 const s=fixture();s.projects.push({id:'other',name:'Project',roots:['/other'],threadIds:[]},{id:'multi',roots:['/same','/other'],threadIds:[]},{id:'empty',roots:[],threadIds:[]},{id:'empty2',roots:[],threadIds:[]});s.rootProjectIds.push('other','multi','empty','empty2');
 assert.equal(sidebarGroups(s).flatMap(g=>g.items).length,5);
});
test('pinned aliases render once and retain manual thread order',()=>{
 const s=fixture();s.pinnedProjectIds=['web'];s.preferences.chats='manual';
 const g=sidebarGroups(s);assert.equal(g[0].id,'pinned');assert.deepEqual(g[0].items[0].children.map(i=>i.value.id),['web-chat','desktop-chat']);assert.equal(g.flatMap(g=>g.items).length,1);
});
test('project picker offers each directory once while keeping same names at distinct paths',()=>{
 const s=fixture();assert.deepEqual(projectFolderOptions([...s.projects,{name:'Project',roots:['/other',null]}]),[{root:'/same/',name:'Project'},{root:'/other',name:'Project'}]);
});
