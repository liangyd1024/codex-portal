import test from 'node:test';
import assert from 'node:assert/strict';
import {turnFiles} from '../public/turn-files.js';

const edit=(id,path,diff,status='completed',kind={type:'update'})=>({id,type:'fileChange',status,changes:[{path,diff,kind}]});
test('files are scoped to native edits in one turn and retain repeated patches in order',()=>{
  const items=[edit('a','/test/project/src/a.js','@@ -1 +1 @@\n-old\n+new'),{type:'agentMessage',text:'/test/project/ignored.js'},edit('b','/test/project/src/a.js','@@ -1 +1 @@\n-new\n+final'),edit('c','/test/project/src/b.js','new content','completed','add')];
  const before=structuredClone(items),files=turnFiles(items,'/test/project/');
  assert.equal(files.length,2);assert.equal(files[0].label,'src/a.js');assert.deepEqual(files[0].edits.map(e=>e.diff),[items[0].changes[0].diff,items[2].changes[0].diff]);
  assert.equal(files[1].edits[0].kind,'add');assert.deepEqual(items,before);
  assert.deepEqual(turnFiles([{type:'agentMessage',text:'下一轮'}]),[]);
});
test('only relativize paths inside the actual project and keep failed or incomplete evidence',()=>{
  const files=turnFiles([edit('a','/test/project-other/a',null,'failed'),edit('b','relative.js','', {type:'inProgress'}),edit('c','/test/project/文档.md','patch',undefined,{type:'update',move_path:'/test/project/new.md'})],'/test/project');
  assert.equal(files[0].label,'/test/project-other/a');assert.equal(files[0].edits[0].status,'failed');assert.equal(files[0].edits[0].diff,null);
  assert.equal(files[1].label,'relative.js');assert.equal(files[1].edits[0].status,'inProgress');assert.equal(files[2].label,'文档.md');
  assert.deepEqual(turnFiles([{type:'fileChange',changes:[{},null]}]),[]);
});
