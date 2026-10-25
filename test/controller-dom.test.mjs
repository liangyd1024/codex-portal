import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {parse} from 'parse5';
const source=readFileSync(new URL('../src/web/controller-dom.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const dom=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
test('controller tag contracts match the unchanged shell and cover literal controller lookups',()=>{
 const ast=ts.createSourceFile('controller-dom.ts',source,ts.ScriptTarget.Latest,true),contract=ast.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text==='ControllerElementTags');
 const expected=new Map(contract.members.map(m=>[m.name.text,m.type.literal.text])),actual=new Map();
 function walk(n){const id=n.attrs?.find(a=>a.name==='id')?.value;if(id)actual.set(id,n.tagName);for(const c of n.childNodes||[])walk(c);}walk(parse(readFileSync(new URL('../public/index.html',import.meta.url),'utf8')));
 for(const [id,tag]of expected)assert.equal(actual.get(id),tag,id);
 const controller=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');for(const m of controller.matchAll(/(?:\$|setText)\(['"]([^'"]+)['"]/g))if(m[1]!=='reason-')assert.ok(expected.has(m[1]),m[1]);
});
test('lookups do not cache replaced nodes and leave missing dynamic feedback nullable',()=>{
 const before=globalThis.document,first={},second={};let current=first;
 globalThis.document={getElementById:id=>id==='message-input'?current:null};
 try{assert.equal(dom.controllerElement('message-input'),first);current=second;assert.equal(dom.controllerElement('message-input'),second);assert.equal(dom.controllerElement('reason-dynamic'),null);}finally{globalThis.document=before;}
});
test('unchanged plain text is retained, while empty values and child content follow baseline replacement',()=>{
 const before=globalThis.document;let value='相同文本',writes=0;const node={childElementCount:0,get textContent(){return value;},set textContent(text){writes++;value=text;this.childElementCount=0;}};
 globalThis.document={getElementById:()=>node};
 try{dom.setText('thread-title','相同文本');assert.equal(writes,0);node.childElementCount=1;dom.setText('thread-title','相同文本');assert.equal(writes,1);for(const v of [null,undefined,''])dom.setText('thread-title',v);assert.equal(value,'—');assert.equal(writes,2);dom.setText('thread-title',0);assert.equal(value,'0');dom.setText('thread-title',false);assert.equal(value,'false');}finally{globalThis.document=before;}
});
