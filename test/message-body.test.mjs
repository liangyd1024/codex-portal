import test from 'node:test';
import assert from 'node:assert/strict';
import {markdown,groupTurnItems} from '../public/message-body.js';
// Minimal DOM for semantic assertions; browser acceptance covers real layout/events.
class Node {
  constructor(tag='',text=''){this.tagName=tag.toUpperCase();this.children=[];this.text=text;this.style={};this.attrs={};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attrs[key]=value;}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text+this.children.map(n=>n.textContent).join('');}
  get childNodes(){return this.children;}
}
globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('',text)};
const all=(n,tag)=>[...(n.tagName===tag?[n]:[]),...n.children.flatMap(c=>all(c,tag))];
const msg=(id,phase)=>({id,type:'agentMessage',phase,text:id});
const tool=id=>({id,type:'commandExecution'});
test('completed commentary folds in chronological order with tools, leaving final answer visible',()=>{
 const items=[{id:'u',type:'userMessage'},msg('progress','commentary'),tool('t1'),msg('progress2','commentary'),tool('t2'),msg('answer','final_answer')];
 const groups=groupTurnItems({status:'completed',items});
 assert.deepEqual(groups.map(g=>g.type),['message','process','message']);
 assert.deepEqual(groups[1].items.map(i=>i.id),['progress','t1','progress2','t2']);
 assert.deepEqual(groups.flatMap(g=>g.items||[g.item]),items);
});
test('live progress, legacy replies and interrupted turns without final answers remain visible',()=>{
 for(const status of ['inProgress',{type:'running'},'interrupted','failed']){
 const groups=groupTurnItems({status,items:[tool('before'),msg('update','commentary'),tool('after')]});
 assert.deepEqual(groups.map(g=>g.type),['process','message','process']);
 }
 const groups=groupTurnItems({status:'completed',items:[tool('before'),msg('legacy'),tool('after'),msg('answer','final_answer')]});
 assert.deepEqual(groups.map(g=>g.type),['process','message','process','message']);
 assert.notEqual(groups[0].key,groups[2].key);
});
test('a final answer never moves ahead of later process items, and failures stay in the timeline',()=>{
 const items=[tool('a'),msg('answer','final_answer'),tool('b'),{id:'e',type:'error'}];
 assert.deepEqual(groupTurnItems({status:'completed',items}).flatMap(g=>g.items||[g.item]),items);
});
test('numbered lists retain start and blank-line continuity, nested lists and paragraphs',()=>{
 const body=markdown('3. 第一项\n\n   继续说明\n   - 内层 **`字段`**\n   - 第二个子项\n\n4. 第二项\n\n正文');
 assert.equal(all(body,'OL').length,1);assert.equal(all(body,'OL')[0].start,3);
 assert.equal(all(body,'OL')[0].children.length,2);assert.equal(all(body,'UL').length,1);
 assert.equal(all(body,'STRONG')[0].children[0].tagName,'CODE');
 assert.equal(body.children.at(-1).tagName,'P');
});
test('tables preserve column alignment and escaped pipe contents with a keyboard scroll target',()=>{
 const body=markdown('| 客户 | 耗时 | 比例 |\n|---|---:|:---:|\n| A\\|B | **16.47** | 20% |');
 const cells=all(body,'TD');assert.equal(cells[0].textContent,'A|B');assert.equal(cells[1].style.textAlign,'right');assert.equal(cells[2].style.textAlign,'center');
 assert.equal(body.children[0].tabIndex,0);assert.equal(body.children[0].attrs.role,'region');
});
test('fences, headings, separators, quotes and inline escapes are rendered semantically',()=>{
 const body=markdown('# 标题\n\n---\n\n> **引用**\n> 第二行\n\n````sql\n```\nSELECT 1\n````\n\n\\*字面量 &lt;tag&gt; &#x20;\n\n*强调* ~~删除~~\n\n换行  \n下一行');
 assert.equal(all(body,'H1').length,1);assert.equal(all(body,'HR').length,1);assert.equal(all(body,'BLOCKQUOTE').length,1);
 assert.equal(all(body,'PRE')[0].textContent,'```\nSELECT 1');assert.equal(all(body,'EM')[0].textContent,'强调');assert.equal(all(body,'DEL')[0].textContent,'删除');
 assert.ok(body.textContent.includes('*字面量 <tag>  '));assert.equal(all(body,'BR').length,1);
 assert.equal(all(markdown('~~~\nunfinished'),'PRE')[0].textContent,'unfinished');
});
test('safe links preserve parentheses and formatted labels; HTML and unsafe URLs never execute',()=>{
 const body=markdown('[**文档**](https://example.com/a_(b)) [文件](</a folder/report.md>) [坏](javascript:alert(1)) <img src=x onerror=alert(1)>');
 const links=all(body,'A');assert.equal(links.length,1);assert.equal(links[0].href,'https://example.com/a_(b)');assert.equal(links[0].children[0].tagName,'STRONG');
 assert.equal(all(body,'IMG').length,0);assert.ok(body.textContent.includes('/a folder/report.md'));assert.ok(body.textContent.includes('<img'));
});
test('unfinished long links remain plain text without exponential parsing',()=>{
 const text='[报告]('+ 'a'.repeat(20000);
 assert.equal(markdown(text).textContent,text);
});
