import test from 'node:test';import assert from 'node:assert/strict';
import {sidebarAction,sidebarCapabilities,PINNED_SECTION} from '../lib/sidebar.mjs';
import {sidebarGroups} from '../public/sidebar.js';
function fixture(){
 const calls=[];const t={id:'t',name:'Original',revision:'r',archived:false,readRevision:'rr',sectionId:null};
 const layout={data:[t],sections:[{id:'s',revision:'sr',name:'Section'}],projects:[{id:'p'}],accountScope:'a',accountLayoutAvailable:true,preferences:{pinned:'manual'}};
 const m={service:{protocolValidation:{policy:4,unsupportedMethods:[]}},requireConnected(){},requireWritable(){},autoTitles:new Map([['t',{}]]),controlled:new Map(),subscriptions:new Map(),startingTurns:new Set(),activeTurns:new Map(),saveTitles(){},saveSubscriptions(){},publish(){},withMutation:fn=>fn(),passive:async(action)=>action==='sidebar'?structuredClone(layout):{data:[{status:'completed'}]},rpc:{connected:true,request:async(method,params)=>{calls.push([method,params]);if(method==='account/read')return {workspaceRouting:{chatgptAccountId:'account'}};if(method==='thread/read')return {thread:{status:{type:'notLoaded'}}};return {};}}};
 return {m,calls,t,layout,input:(action,extra={})=>({action,id:'t',expectedRevision:'r',accountScope:'a',...extra})};
}
test('pin and rename use allowlisted engine writes and protect manual titles',async()=>{
 const {m,calls,input}=fixture();await sidebarAction(m,input('pin',{pinned:true}));assert.deepEqual(calls.at(-1),['thread/section/move',{threadId:'t',sectionId:PINNED_SECTION}]);
 await assert.rejects(sidebarAction(m,input('moveProject',{projectId:'p'})),e=>e.code==='FEATURE_UNAVAILABLE');
 await sidebarAction(m,input('rename',{name:'Manual'}));assert.equal(m.autoTitles.has('t'),false);assert.equal(calls.at(-1)[0],'thread/name/set');
});
test('conflicting revision, account change, busy mutation and unsupported capabilities never write',async()=>{
 for(const kind of ['revision','account','busy','unsupported']){
  const {m,calls,input}=fixture(),p=input('pin',{pinned:true});if(kind==='revision')p.expectedRevision='old';if(kind==='account')p.accountScope='other';if(kind==='busy')m.sidebarMutation=true;if(kind==='unsupported')m.service.protocolValidation.policy=3;
  await assert.rejects(sidebarAction(m,p));assert.ok(calls.every(([name])=>name==='account/read'));
 }
});
test('active or unknown archive status is blocked; idle archive does not interrupt or delete',async()=>{
 for(const status of ['active','unknown']){const {m,input,calls}=fixture();m.rpc.request=async(name,p)=>{calls.push([name,p]);return name==='account/read'?{}:{thread:{status:{type:status}}};};await assert.rejects(sidebarAction(m,input('archive')));assert.ok(!calls.some(([name])=>name==='thread/archive'));}
 const {m,input,calls}=fixture();await sidebarAction(m,input('archive'));assert.equal(calls.at(-1)[0],'thread/archive');assert.ok(!calls.some(([name])=>/interrupt|delete/.test(name)));
});
test('unknown mutation outcome is not replayed and unread uses the seen receipt',async()=>{
 const {m,input,calls}=fixture();const request=m.rpc.request;m.rpc.request=async(name,p)=>{if(name==='thread/readState/update'){calls.push([name,p]);throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});}return request(name,p);};
 await assert.rejects(sidebarAction(m,input('read',{read:false})),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(calls.filter(([n])=>n==='thread/readState/update').length,1);assert.equal(calls.at(-1)[1].expectedRevision,'rr');assert.equal(m.sidebarMutation,false);
});
test('section rendering deduplicates pins and preserves unassigned chats without fake projects',()=>{
 const t={id:'t'},u={id:'u'};const s={data:[t,u],projects:[{id:'p',threadIds:['t']}],sections:[{id:'s',projectIds:['p'],threadIds:[]}],rootThreadIds:['u'],rootProjectIds:['p'],pinnedThreadIds:['t'],pinnedProjectIds:[],sectionOrder:[]};
 const groups=sidebarGroups(s);assert.equal(groups.find(g=>g.id==='pinned').items[0].value.id,'t');assert.equal(groups.find(g=>g.id==='s').items[0].children.length,0);assert.deepEqual(groups.find(g=>g.id==='chats').items.map(i=>i.value.id),['u']);
});
