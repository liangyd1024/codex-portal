import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMessages} from '../public/message-dom.js';
class Node {
  constructor(name='DIV',key='',text=''){this.nodeName=name;this.tagName=name;this.nodeType=name==='#text'?3:1;this.data=text;this.dataset=key?{messageId:key}:{};this.childNodes=[];this.attrs=new Map();}
  get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
  hasAttribute(k){return this.attrs.has(k);}getAttribute(k){return this.attrs.get(k);}setAttribute(k,v){this.attrs.set(k,v);}removeAttribute(k){this.attrs.delete(k);}
  matches(){return false;}
  get firstChild(){return this.childNodes[0]||null;}
  get nextSibling(){return this.parent?.childNodes[this.parent.childNodes.indexOf(this)+1]||null;}
  insertBefore(n,b){n.remove();const i=b?this.childNodes.indexOf(b):this.childNodes.length;assert.ok(i>=0);this.childNodes.splice(i,0,n);n.parent=this;}
  append(...ns){for(const n of ns)this.insertBefore(n,null);}
  remove(){if(this.parent){this.parent.childNodes.splice(this.parent.childNodes.indexOf(this),1);this.parent=null;}}
  replaceWith(n){this.parent.insertBefore(n,this);this.remove();}
}
const text=value=>new Node('#text','',value);
const message=(id,value)=>{const n=new Node('ARTICLE',id);n.append(text(value));return n;};
const tree=(...ns)=>{const n=new Node();n.append(...ns);return n;};
test('streaming updates retain history, live article and text nodes across 100 deltas',()=>{
 const history=message('history','原始正文'),live=message('live',''),parent=tree(history,live),leaf=live.firstChild;
 for(let i=0;i<100;i++)reconcileMessages(parent,tree(message('history','原始正文'),message('live','正文'.repeat(i))));
 assert.equal(parent.firstChild,history);assert.equal(parent.childNodes[1],live);assert.equal(live.firstChild,leaf);assert.equal(leaf.data,'正文'.repeat(99));
});
test('keyed prepend, removal, reorder and same-key type replacement have exact order',()=>{
 const a=message('a','a'),b=message('b','b'),parent=tree(a,b);
 reconcileMessages(parent,tree(message('new','new'),message('b','b'),message('a','a')));
 assert.deepEqual(parent.childNodes.map(n=>n.dataset.messageId),['new','b','a']);assert.equal(parent.childNodes[1],b);
 reconcileMessages(parent,tree(new Node('SECTION','b'),message('a','a')));
 assert.deepEqual(parent.childNodes.map(n=>n.nodeName),['SECTION','ARTICLE']);assert.equal(parent.childNodes[1],a);
 reconcileMessages(parent,tree());assert.equal(parent.childNodes.length,0);
});
test('details remain open and text can change structure without accumulating stale nodes',()=>{
 const old=new Node('DETAILS','process');old.setAttribute('open','');old.append(text('old'));
 const fresh=new Node('DETAILS','process');fresh.append(new Node('P'),text('new'));
 const parent=tree(old);reconcileMessages(parent,tree(fresh));
 assert.equal(parent.firstChild,old);assert.equal(old.hasAttribute('open'),true);assert.deepEqual(old.childNodes.map(n=>n.nodeName),['P','#text']);
});
test('image load state and retries persist only for the same source',()=>{
 const image=src=>{const n=new Node('SPAN');n.dataset.source=src;n.matches=selector=>selector==='.message-image';return n;};
 const old=image('first.png'),parent=tree(old);old.setAttribute('data-loaded','true');
 reconcileMessages(parent,tree(image('first.png')));assert.equal(parent.firstChild,old);assert.equal(old.getAttribute('data-loaded'),'true');
 reconcileMessages(parent,tree(image('second.png')));assert.equal(parent.firstChild.dataset.source,'second.png');
});

test('file cards retain cached toggles and replace changed cards with their own lazy handlers',()=>{
 const card=()=>{const n=new Node('SECTION');n.dataset.itemId='files';n.matches=selector=>selector==='.turn-file-changes';return n;};
 const old=card(),parent=tree(old);reconcileMessages(parent,tree(old));assert.equal(parent.firstChild,old);
 const fresh=card();reconcileMessages(parent,tree(fresh));assert.equal(parent.firstChild,fresh);
});

test('retained cached nodes move into new groups without rebuilding, and changed nodes bind to reconciled DOM',async t=>{
 const {RenderCache}=await import('../public/render-cache.js');
 const previous=globalThis.document;globalThis.document={createTextNode:()=>text('')};t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
 Node.prototype.querySelectorAll=function(){return this.childNodes.flatMap(n=>[...(n.dataset.renderKey?[n]:[]),...n.querySelectorAll()]);};
 const cache=new RenderCache(),parent=tree();let builds=0;
 const item=(value='a')=>cache.render('item:a',value,()=>{builds++;return message('a',value);});
 reconcileMessages(parent,tree(item()));cache.bind(parent);const original=parent.firstChild;
 for(let i=0;i<10;i++){reconcileMessages(parent,tree(item()));cache.bind(parent);}assert.equal(builds,1);assert.equal(parent.firstChild,original);
 const group=new Node('DETAILS','group');group.append(item());reconcileMessages(parent,tree(group));cache.bind(parent);assert.equal(parent.firstChild.firstChild,original);
 const changed=new Node('DETAILS','group');changed.append(item('changed'));reconcileMessages(parent,tree(changed));cache.bind(parent);assert.equal(parent.firstChild.firstChild,original);assert.equal(original.firstChild.data,'changed');
 const next=new Node('DETAILS','group');next.append(item('changed'));reconcileMessages(parent,tree(next));assert.equal(parent.firstChild.firstChild,original);assert.equal(builds,2);
 reconcileMessages(parent,tree());cache.bind(parent);assert.equal(cache.entries.size,0);
});
