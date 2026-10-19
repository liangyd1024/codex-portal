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
 addEventListener(name,fn){(this.events??={})[name]=fn;}
 showModal(){this.open=true;}
 close(){this.open=false;this.events?.close?.();}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){}
 add(node){this.append(node);}
 closest(tag){return this.tag===tag?this:this.parent?.closest(tag);}
 querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='details[open]'&&n.tag==='details'&&n.open?[n]:[]),...n.querySelectorAll(selector)]);}
}
test('task edit stays on task details until explicitly opening management chat',async t=>{
 const body=new Element('body'),main=new Element('main'),footer=new Element('footer'),calls=[],opened=[];let broken=false,name='Task';
 const previousDocument=globalThis.document,previousOption=globalThis.Option;
 globalThis.document={body,createElement:tag=>new Element(tag),querySelector:s=>s==='.main-panel'?main:footer};
 globalThis.Option=class extends Element {constructor(text,value){super('option');this.textContent=text;this.value=value;}};
 t.after(()=>{globalThis.document=previousDocument;globalThis.Option=previousOption;});
 const view=installAutomations({onOpen(){},openSession:async(...args)=>opened.push(args),openThread(){},api:async(path)=>{
  calls.push(path);if(broken)throw Error('offline');return {threadId:'thread',items:[{id:'native-id',name,status:'PAUSED',rrule:'FREQ=DAILY;BYHOUR=8',prompt:'native prompt',kind:'heartbeat'}],runs:[],observedAt:Date.now()};
 }});
 view.open();await new Promise(r=>setImmediate(r));const page=main.children[0],list=page.children[3];
 assert.deepEqual(page.children[1].children.map(n=>n.tag),['button','input','select']);
 assert.equal(page.children[1].children[0].textContent,'＋ 新建任务');
 assert.equal(list.children.length,1);const row=list.children[0];assert.equal(row.dataset.id,'native-id');assert.equal(row.children[0].textContent,'Task');
 await row.children[2].children[1].children[0].onclick();
 assert.equal(opened.length,0);assert.equal(body.children.length,1);
 let panel=body.children[0];assert.equal(panel.children[0].children[0].textContent,'Task');
 const content=panel.children[1];assert.match(content.children[2].textContent,/与下方执行会话可能不同/);
 await content.children[3].onclick();assert.equal(opened[0][0],'thread');assert.match(opened[0][1],/native-id/);assert.deepEqual(calls,['/api/automations']);
 assert.equal(body.children.length,0);
 await row.children[0].onclick();assert.equal(opened.length,1);assert.equal(body.children[0].children[1].children[1].textContent,'编辑任务');
 body.children[0].close();
 await row.children[2].children[1].children[1].onclick();
 panel=body.children[0];assert.equal(panel.children[1].children[1].textContent,'删除任务');assert.equal(opened.length,1);
 panel.children[1].children[3].onclick();assert.match(opened[1][1],/只删除这一项/);
 name='Renamed';await view.refresh();assert.equal(list.children[0].children[0].textContent,'Renamed');
 broken=true;await view.refresh();assert.equal(list.children.length,1);assert.match(page.children[2].textContent,/同步失败/);
});
