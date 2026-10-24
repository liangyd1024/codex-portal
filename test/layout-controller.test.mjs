import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/layout.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createLayoutController}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(t,saved={}){
 class Node extends EventTarget{
  values=new Map();classes=new Set();clientHeight=600;clicks=0;
  classList={contains:k=>this.classes.has(k),add:(...keys)=>keys.forEach(k=>this.classes.add(k)),remove:(...keys)=>keys.forEach(k=>this.classes.delete(k)),toggle:(k,on)=>{if(on??!this.classes.has(k))this.classes.add(k);else this.classes.delete(k);}};
  style={setProperty:(k,v)=>this.values.set(k,v)};
  setAttribute(k,v){this.values.set(k,v);}getAttribute(k){return this.values.get(k)??null;}
  getBoundingClientRect(){return {width:this.width??266};}setPointerCapture(id){this.pointerId=id;}
  querySelector(){return this.button??null;}click(){this.clicks++;}
 }
 const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const values=new Map(Object.entries(saved)),writes=[];const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);writes.push([k,v]);}};
 const window=Object.assign(new Node(),{innerWidth:1480}),body=new Node();let compact=false;
 element('inspector').width=296;element('inspector').button=new Node();
 for(const [key,value] of Object.entries({window,document:{body},localStorage:storage,ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}}})){
  const old=globalThis[key];globalThis[key]=value;t.after(()=>{if(old===undefined)delete globalThis[key];else globalThis[key]=old;});
 }
 const controller=createLayoutController({element,compact:()=>compact});
 const fire=(id,type,fields={})=>{const e=Object.assign(new Event(type,{cancelable:true}),fields);element(id).dispatchEvent(e);return e;};
 return {controller,element,values,writes,storage,window,body,fire,mobile:value=>{compact=value;}};
}
test('layout preserves desktop preference while mobile drawers exclude one another',t=>{
 const f=fixture(t),c=f.controller,s=f.element('app-shell');
 c.toggleSidebar(false);assert.equal(f.values.get('rcm.layout.sidebar'),'false');assert.ok(s.classes.has('sidebar-hidden'));
 f.mobile(true);c.toggleSidebar(true);assert.ok(s.classes.has('sidebar-open'));assert.ok(s.classes.has('inspector-hidden'));assert.equal(f.values.get('rcm.layout.sidebar'),'false');
 c.toggleInspector(true);assert.ok(!s.classes.has('sidebar-open'));assert.ok(!s.classes.has('inspector-hidden'));assert.equal(f.element('inspector').button.clicks,1);assert.equal(f.element('open-sidebar').getAttribute('aria-expanded'),'false');
 c.toggleSidebar(true,false);assert.ok(s.classes.has('sidebar-open'));assert.ok(s.classes.has('inspector-hidden'));assert.equal(f.writes.length,1);
});
test('layout resize keeps keyboard increments, drag ownership, cancellation and saved values',t=>{
 const f=fixture(t,{'rcm.layout.sidebarWidth':'300','rcm.layout.threadsRatio':'0.4'});f.controller.setupResizableLayout();
 const handle=f.element('sidebar-resizer'),shell=f.element('app-shell');assert.equal(shell.values.get('--sidebar'),'300px');
 assert.ok(f.fire('sidebar-resizer','keydown',{key:'ArrowRight'}).defaultPrevented);assert.equal(shell.values.get('--sidebar'),'316px');
 f.element('sidebar').width=316;f.fire('sidebar-resizer','pointerdown',{button:0,pointerId:1,clientX:316,clientY:0});
 f.fire('sidebar-resizer','pointermove',{pointerId:2,clientX:900,clientY:0});assert.equal(shell.values.get('--sidebar'),'316px');
 f.fire('sidebar-resizer','pointermove',{pointerId:1,clientX:900,clientY:0});assert.equal(shell.values.get('--sidebar'),'520px');
 f.fire('sidebar-resizer','pointercancel');assert.ok(!f.body.classes.has('resizing-layout'));assert.equal(f.values.get('rcm.layout.sidebarWidth'),'520');assert.equal(f.values.get('rcm.layout.threadsRatio'),'0.4');
 const count=f.writes.length;f.fire('sidebar-resizer','lostpointercapture');assert.equal(f.writes.length,count);
 f.fire('sidebar-resizer','dblclick');assert.equal(shell.values.get('--sidebar'),'266px');
 f.window.innerWidth=600;f.window.dispatchEvent(new Event('resize'));assert.equal(shell.values.get('--sidebar'),'220px');assert.equal(handle.getAttribute('aria-valuemax'),'220');
});
test('layout tolerates malformed and inaccessible browser storage without losing controls',t=>{
 const f=fixture(t,{'rcm.layout.sidebarWidth':'"bad"','rcm.layout.threadsRatio':'{' });f.controller.setupResizableLayout();assert.equal(f.element('app-shell').values.get('--sidebar'),'266px');
 f.storage.getItem=()=>{throw Error('denied');};f.storage.setItem=()=>{throw Error('quota');};
 assert.equal(f.controller.readLayout('sidebar',true),true);assert.doesNotThrow(()=>f.controller.toggleSidebar(false));assert.doesNotThrow(()=>f.fire('sidebar-resizer','keydown',{key:'ArrowLeft'}));assert.equal(f.element('app-shell').values.get('--sidebar'),'250px');
});
