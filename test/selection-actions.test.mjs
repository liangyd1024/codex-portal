import test from 'node:test';
import assert from 'node:assert/strict';
import {configureAnnotationView,installResponseAnnotations} from '../public/response-annotations.js';
function fixture(t,{mobile=true}={}){
 const saved=new Map();const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 t.after(()=>{for(const [key,value] of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const node=()=>Object.assign(new EventTarget(),{hidden:true,style:{},contains:()=>false,closest:()=>null,focus(){this.focused=true;},getBoundingClientRect:()=>({left:20,top:200,bottom:225,width:200}),offsetHeight:52,offsetWidth:300});
 const menu=node(),editor=node(),comment=node(),chip=node(),details=node(),input=node(),messages=node(),scroller=node();
 const first={dataset:{messageId:'reply'},closest:()=>({dataset:{turnId:'turn'}})},textNode={nodeType:3,parentElement:{closest:()=>first}};
 const range={startContainer:textNode,endContainer:textNode,startOffset:0,cloneRange(){return {...this,selectNodeContents(){},setEnd(){},toString:()=>''};},getBoundingClientRect:()=>({left:20,top:200,bottom:225,width:200})};
 let selected='',id='thread',actions;const selection={rangeCount:1,isCollapsed:false,toString:()=>selected,getRangeAt:()=>range,removeAllRanges(){this.isCollapsed=true;this.rangeCount=0;}};
 messages.contains=el=>el===first;
 const doc=Object.assign(new EventTarget(),{activeElement:null,getElementById:key=>({'message-input':input,messages,'messages-scroller':scroller}[key])});
 set('document',doc);set('window',Object.assign(new EventTarget(),{visualViewport:null}));set('innerWidth',390);set('innerHeight',844);set('matchMedia',()=>({matches:mobile}));set('sessionStorage',{getItem:()=>null,setItem(){}});set('getSelection',()=>selection);set('requestAnimationFrame',()=>1);set('MutationObserver',class{observe(){}});
 configureAnnotationView(value=>{actions=value;return {menu,editor,comment,chip,details,patch(p){if('menuHidden'in p)menu.hidden=p.menuHidden;if('editorHidden'in p)editor.hidden=p.editorHidden;},drafts(){},markers(){}};});
 const side=[];const api=installResponseAnnotations({host:'fixture',context:()=>({id}),onSideChat:s=>side.push(s),changed(){},notify(){}});api.render();
 return {menu,editor,input,selection,side,actions,select(text='测试选文'){selected=text;selection.isCollapsed=false;selection.rangeCount=1;doc.dispatchEvent(new Event('selectionchange'));},collapse(){selection.removeAllRanges();doc.dispatchEvent(new Event('selectionchange'));},switch(){id='other';api.render();},scroll(){scroller.dispatchEvent(new Event('scroll'));}};
}
test('touch selection leaves placement to the composer layout and never focuses the input',t=>{
 const f=fixture(t);f.select();assert.equal(f.menu.hidden,false);assert.equal(f.menu.style.top,undefined);assert.equal(f.input.focused,undefined);f.select('调整选区');assert.equal(f.menu.style.top,undefined);f.actions.side();assert.equal(f.side[0].text,'调整选区');assert.equal(f.menu.hidden,true);
});
test('desktop selection retains its floating placement',t=>{const f=fixture(t,{mobile:false});f.select();assert.equal(f.menu.hidden,false);assert.equal(f.menu.style.top,'140px');});
test('cancel clears native selection without opening the keyboard, and the same text can be selected again',t=>{const f=fixture(t);f.select();f.actions.cancel();assert.equal(f.menu.hidden,true);assert.equal(f.selection.rangeCount,0);assert.equal(f.input.focused,undefined);f.collapse();f.select();assert.equal(f.menu.hidden,false);});
test('clearing selection or changing conversation hides actions and discards the previous target',t=>{const f=fixture(t);f.select();f.collapse();assert.equal(f.menu.hidden,true);f.actions.side();assert.equal(f.side.length,0);f.select();f.switch();assert.equal(f.menu.hidden,true);f.actions.side();assert.equal(f.side.length,0);});
