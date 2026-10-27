import test from 'node:test';
import assert from 'node:assert/strict';
import {markdown,groupTurnItems} from '../public/message-body.js';
// Minimal DOM for semantic assertions; browser acceptance covers real layout/events.
class Node {
  constructor(tag='',text=''){this.tagName=tag.toUpperCase();this.children=[];this.text=text;this.style={};this.attrs={};this.dataset={};}
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
test('SQL code blocks preserve text and expose language, scrolling and copy',async()=>{
 const sql='SELECT id, total_amount\nFROM billing_trans\n  WHERE status = 3;';let copied;
 Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async value=>{copied=value;}}},configurable:true});
 const body=markdown('```sql\n'+sql+'\n```');const pre=all(body,'PRE')[0];assert.equal(pre.textContent,sql);assert.equal(pre.tabIndex,0);
 const button=all(body,'BUTTON')[0];assert.equal(button.attrs['aria-label'],'复制 sql代码');await button.onclick();assert.equal(copied,sql);assert.ok(body.textContent.includes('已复制'));
});
test('Markdown images render through scoped resolver; code examples do not load media',()=>{
 const calls=[];const options={image:(path,alt)=>{calls.push({path,alt});return new Node('img');}};
 const body=markdown('![图](</tmp/a b.png>)\n\n`![代码](/tmp/code.png)`\n\n```text\n![示例](/tmp/example.png)\n```',0,options);
 assert.equal(all(body,'IMG').length,1);assert.deepEqual(calls,[{path:'/tmp/a b.png',alt:'图'}]);
 assert.equal(groupTurnItems({status:'completed',items:[{type:'imageGeneration',result:'image'}]})[0].type,'message');
});
test('file resolver preserves formatted link labels and ignores fenced code and unsafe URLs',()=>{
 const calls=[];const body=markdown('[**视频**](</tmp/中文 (1).mp4>)\n\n`[例子](/tmp/no.mp4)`\n\n```md\n[代码](/tmp/no.mp4)\n```',0,{file:(path,label)=>{calls.push({path,label});return new Node('a');}});
 assert.equal(all(body,'A').length,1);assert.equal(all(body,'A')[0].textContent,'视频');assert.equal(all(body,'STRONG').length,1);assert.deepEqual(calls,[{path:'/tmp/中文 (1).mp4',label:'**视频**'}]);
});

test('native goal inputs remain visible before completed process and final answer',()=>{
  const goal={id:'native-goal',type:'goalMessage',objective:'目标原文'};
  const groups=groupTurnItems({status:'completed',items:[goal,{id:'tool',type:'commandExecution'},{id:'answer',type:'agentMessage',phase:'final_answer',text:'完成'}]});
  assert.equal(groups[0].type,'message');
  assert.equal(groups[0].item,goal);
  assert.equal(groups[1].type,'process');
  assert.equal(groups[2].item.id,'answer');
});

test('Mermaid enhances only complete fences and preserves source verbatim',()=>{
 const source='flowchart LR\n  A[开始] --> B[结束]';
 const body=markdown('```mermaid\n'+source+'\n```');
 assert.equal(body.children[0].dataset.mermaidSource,source);
 assert.equal(all(body,'PRE')[0].textContent,source);
 assert.equal(all(body,'PRE')[0].hidden,true);
 assert.deepEqual(all(body,'BUTTON').map(n=>n.textContent),['复制代码','源码','放大','重试']);
 for(const text of ['```mermaid\n'+source,'```javascript\n'+source+'\n```']){
   const plain=markdown(text);assert.equal(plain.children[0].dataset.mermaidSource,undefined);
   assert.equal(all(plain,'PRE')[0].textContent,source);assert.equal(all(plain,'BUTTON').length,1);
 }
});

test('native steering input remains an individual visible message rather than a tool disclosure',()=>{
 const input={id:'steer',type:'steeringUserMessage',status:'accepted',input:[{type:'text',text:'中文补充原文'}]};
 const groups=groupTurnItems({status:'inProgress',items:[{id:'tool',type:'commandExecution'},input]});
 assert.equal(groups[1].type,'message');assert.equal(groups[1].item,input);
});
