import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBrowser,selectBrowser,validateBrowser} from '../public/browser-backup.js';
const host=id=>({id,machineId:'machine-'+id,home:'/Users/test',user:'test'});
const config={machineId:'origin',data:['a','b','new'].map(id=>({id,host:host(id)}))};
function backup(){return {format:'rcm-browser',version:1,machineId:'origin',connections:['a','b','removed'].map(host),localStorage:{'rcm.connection':'b','rcm.layout':'global','rcm.autoRefresh.a':'true','rcm.autoRefresh.b':'false','rcm.sidebar.expanded.a.scope':'[]','rcm.sidebar.expanded.ab.scope':'[]','rcm.capacity.["a","thread","turn"]':'pending'},sessionStorage:{'rcm.drafts.a':'draft-a','rcm.drafts.b':'draft-b','rcm.drafts.ab':'wrong','rcm.desktopSends.a':'pending','rcm.project-create.a:/project':'token'},cache:{database:'rcm.recovery.v2',rows:['a','b','removed'].map(id=>({key:JSON.stringify([id,'thread']),detail:{thread:{id:'thread'}}}))}};}
test('partial backup selects only matched identities and bounded per-target keys',()=>{
 const data=backup();const original=structuredClone(data);
 assert.deepEqual(inspectBrowser(data,config).map(x=>x.compatible),[true,true,false]);
 assert.throws(()=>validateBrowser(data,config));
 const selected=selectBrowser(data,config,['a']);
 assert.deepEqual(selected.sessionStorage,{'rcm.drafts.a':'draft-a'});
 assert.deepEqual(selected.localStorage,{'rcm.autoRefresh.a':'true','rcm.sidebar.expanded.a.scope':'[]'});
 assert.deepEqual(selected.cache.rows.map(row=>JSON.parse(row.key)[0]),['a']);
 assert.deepEqual(data,original);
 assert.equal(validateBrowser(selected,config),selected);
});
test('wrong machine, changed identity, malformed cache and invalid selections cannot import',()=>{
 for(const ids of [[],['removed'],['a','a'],['unknown']])assert.throws(()=>selectBrowser(backup(),config,ids));
 for(const field of ['home','user','machineId']){const data=backup();data.connections[0][field]='changed';assert.throws(()=>selectBrowser(data,config,['a']));assert.equal(selectBrowser(data,config,['b']).cache.rows.length,1);}
 for(const mutate of [d=>d.machineId='other',d=>d.connections.push(host('a')),d=>d.cache.rows[0].key='broken',d=>d.cache.rows[0].detail.thread.id='wrong',d=>d.localStorage.cookie='secret']){const data=backup();mutate(data);assert.throws(()=>selectBrowser(data,config,['a']));}
});
