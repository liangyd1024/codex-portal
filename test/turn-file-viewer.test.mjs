import test from 'node:test';
import assert from 'node:assert/strict';
import {openTurnFileViewer,closeTurnFileViewer} from '../public/turn-file-viewer.js';

class Element extends EventTarget {
  constructor(tag){super();this.tagName=tag;this.children=[];this.attrs={};this.selectedIndex=0;this.isConnected=false;}
  append(...nodes){this.children.push(...nodes);for(const node of nodes){node.parent=this;node.isConnected=true;}}
  replaceChildren(){this.children=[];}
  setAttribute(key,value){this.attrs[key]=value;}
  get options(){return this.children;}
  focus(){this.focused=true;}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
test('viewer renders only selected original records, bounds navigation and removes snapshots on close',t=>{
  const previous=globalThis.document,body=new Element('body');
  globalThis.document={body,createElement:tag=>new Element(tag)};
  t.after(()=>{closeTurnFileViewer();globalThis.document=previous;});
  const files=[{label:'src/a.js',edits:['first','second']},{label:'src/b.js',edits:['last']}],rendered=[];
  const trigger=new Element('button');trigger.isConnected=true;
  const dialog=openTurnFileViewer(files,{trigger,renderEdits:(container,file)=>{rendered.push(file);container.append(new Element('pre'));}});
  const select=dialog.children[2].children[1],navigation=dialog.children[3],content=dialog.children[4];
  assert.deepEqual(rendered,[files[0]]);assert.equal(navigation.children[0].disabled,true);assert.equal(navigation.children[2].disabled,false);
  navigation.children[2].onclick();assert.equal(select.selectedIndex,1);assert.equal(navigation.children[2].disabled,true);assert.equal(content.children.length,1);assert.equal(rendered.at(-1),files[1]);
  select.selectedIndex=0;select.onchange();assert.equal(rendered.at(-1),files[0]);assert.equal(navigation.children[1].textContent,'1 / 2');
  closeTurnFileViewer();assert.equal(body.children.length,0);assert.equal(dialog.open,false);assert.equal(trigger.focused,true);
  assert.equal(openTurnFileViewer([]),undefined);
});
