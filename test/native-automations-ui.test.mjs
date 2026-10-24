import test from 'node:test';
import assert from 'node:assert/strict';
import {installAutomations,configureAutomationViews,scheduleLabel} from '../public/automations.js';
import {matchingTasks,taskPresentation} from '../src/web/services/automation-view.ts';
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
test('task editing only opens the bound management chat after the explicit action',async t=>{
 const body=new Element('body'),main=new Element('main'),footer=new Element('footer'),calls=[],opened=[],threads=[];let broken=false,name='Task',rows,showTask,taskView,controls,controlsState={loading:false,feedback:""},search=new Element("input"),disposed=0;
 const previousDocument=globalThis.document,previousOption=globalThis.Option;
 globalThis.document={body,createElement:tag=>new Element(tag),querySelector:s=>s==='.main-panel'?main:footer};
 globalThis.Option=class extends Element {constructor(text,value){super('option');this.textContent=text;this.value=value;}};
 configureAutomationViews({controls(options){controls=options;return {search,createButton:new Element("button"),setState(update){Object.assign(controlsState,update);}};},list(options){showTask=options.showTask;return {render(value){rows=value;}};},task(options){taskView=options;return {closeButton:new Element('button'),dispose(){disposed++;}};}});
 t.after(()=>{globalThis.document=previousDocument;globalThis.Option=previousOption;configureAutomationViews(undefined);});
 const view=installAutomations({onOpen(){},openSession:async(...args)=>opened.push(args),openThread:id=>threads.push(id),api:async(path)=>{
  calls.push(path);if(broken)throw Error('offline');return {threadId:'management',items:[{id:'native-id',name,status:'PAUSED',rrule:'FREQ=DAILY;BYHOUR=8',prompt:'native prompt',kind:'heartbeat',target_thread_id:'execution',unknown:{keep:true}}],runs:[],observedAt:Date.now()};
 }});
 view.open();assert.equal(controlsState.loading,true);assert.match(controlsState.feedback,/正在同步/);await new Promise(r=>setImmediate(r));
 assert.equal(controlsState.loading,false);assert.match(controlsState.feedback,/与目标机器 Codex 共用任务/);
 assert.equal(rows.length,1);const task=rows[0].task;assert.equal(task.id,'native-id');assert.equal(task.name,'Task');assert.deepEqual(task.unknown,{keep:true});
 showTask(task,'edit');assert.equal(opened.length,0);assert.equal(body.children.length,1);
 assert.equal(taskView.view.name,'Task');assert.match(taskView.view.explanation,/与下方执行会话可能不同/);
 taskView.manage();assert.equal(opened[0][0],'management');assert.match(opened[0][1],/native-id/);assert.deepEqual(calls,['/api/automations']);assert.equal(body.children.length,0);assert.equal(disposed,1);
 showTask(task);assert.equal(opened.length,1);assert.equal(taskView.view.mode,'view');
 taskView.edit();assert.equal(taskView.view.mode,'edit');assert.equal(opened.length,1);taskView.dialog.close();
 showTask(task,'delete');assert.equal(taskView.view.heading,'删除任务');assert.equal(opened.length,1);taskView.manage();assert.match(opened[1][1],/只删除这一项/);
 showTask(task);taskView.openThread(taskView.view.targetThreadId);assert.deepEqual(threads,['execution']);assert.equal(opened.length,2);
 name='Renamed';await view.refresh();assert.equal(rows[0].task.name,'Renamed');
 const previous=rows;broken=true;await view.refresh();assert.equal(rows,previous);assert.match(controlsState.feedback,/同步失败/);assert.equal(controlsState.loading,false);
 search.value='missing';controls.onSearch();assert.equal(rows.length,0);search.value='';controls.onSearch();assert.equal(rows.length,1);controls.onFilter('ACTIVE');assert.equal(rows.length,0);controls.onFilter('all');assert.equal(rows.length,1);await controls.onCreate();assert.equal(opened.at(-1)[0],'management');assert.equal(opened.at(-1)[1],'请帮我创建一个定时任务。');
});

test('task filtering keeps raw identities, stable native order and unknown run statuses',()=>{
 const tasks=[{id:'paused',name:' Paused Task',status:'PAUSED',next_run_at:null},{id:'later',name:'Task Later',status:'ACTIVE',next_run_at:8},{id:'soon',name:'Task Soon',status:'ACTIVE',next_run_at:3},{id:'same',name:'Task Same',status:'ACTIVE',next_run_at:3}];
 assert.deepEqual(matchingTasks(tasks,'all',' TASK ').map(t=>t.id),['soon','same','later','paused']);
 assert.equal(matchingTasks(tasks,'PAUSED','paused')[0],tasks[0]);assert.deepEqual(tasks.map(t=>t.id),['paused','later','soon','same']);
 const task={...tasks[0],rrule:'FREQ=HOURLY;INTERVAL=2',prompt:'完整原生内容',kind:'heartbeat',target_thread_id:'execution'};
 const detail=taskPresentation(task,'delete',[{automation_id:'other',thread_id:'ignore',created_at:1,status:'ACCEPTED'},{automation_id:task.id,thread_id:'run',created_at:2,status:'FUTURE_STATUS'}],n=>'T'+n,scheduleLabel);
 assert.deepEqual(detail.runs,[{threadId:'run',label:'T2 · FUTURE_STATUS'}]);assert.equal(detail.prompt,task.prompt);assert.match(detail.emptyRuns,/原会话运行/);assert.match(detail.managePrompt,/只删除这一项/);
});
