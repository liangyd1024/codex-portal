import test from 'node:test';
import assert from 'node:assert/strict';
import {installAutomations} from '../public/automations.js';
// Minimal DOM surface used by the task browser. No native or engine writes.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';this.classList={add(){},remove(){}};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 insertBefore(node){this.append(node);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(){}
 add(node){this.append(node);}
 closest(tag){return this.tag===tag?this:this.parent?.closest(tag);}
 querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='details[open]'&&n.tag==='details'&&n.open?[n]:[]),...n.querySelectorAll(selector)]);}
}
test('task browser renders native rows, retains expanded details and only prepares mutation drafts',async t=>{
 const main=new Element('main'),footer=new Element('footer'),calls=[],opened=[];let broken=false,name='Task';
 const previousDocument=globalThis.document,previousOption=globalThis.Option;
 globalThis.document={createElement:tag=>new Element(tag),querySelector:s=>s==='.main-panel'?main:footer};
 globalThis.Option=class extends Element {constructor(text,value){super('option');this.textContent=text;this.value=value;}};
 t.after(()=>{globalThis.document=previousDocument;globalThis.Option=previousOption;});
 const view=installAutomations({onOpen(){},openSession:async(...args)=>opened.push(args),openThread(){},api:async(path)=>{
  calls.push(path);if(broken)throw Error('offline');return {threadId:'thread',items:[{id:'native-id',name,status:'PAUSED',rrule:'FREQ=DAILY;BYHOUR=8',prompt:'native prompt',kind:'heartbeat'}],runs:[],observedAt:Date.now()};
 }});
 view.open();await new Promise(r=>setImmediate(r));const page=main.children[0],list=page.children[3];
 assert.equal(list.children.length,1);const row=list.children[0];assert.equal(row.dataset.id,'native-id');assert.equal(row.children[0].textContent,'Task');
 await row.children[2].children[1].onclick();assert.equal(opened[0][0],'thread');assert.match(opened[0][1],/native-id/);assert.deepEqual(calls,['/api/automations']);
 row.children[3].open=true;name='Renamed';await view.refresh();assert.equal(list.children[0].children[0].textContent,'Renamed');assert.equal(list.children[0].children[3].open,true);
 broken=true;await view.refresh();assert.equal(list.children.length,1);assert.match(page.children[2].textContent,/同步失败/);
});
