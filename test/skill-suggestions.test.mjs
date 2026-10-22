import test from 'node:test';
import assert from 'node:assert/strict';
import {skillQuery} from '../public/skill-suggestions.js';
test('skill completion recognizes slash and dollar at the caret without matching paths or URLs',()=>{
  assert.deepEqual(skillQuery('请用 /rem 后续',7),{start:3,end:7,query:'rem'});
  assert.deepEqual(skillQuery('$中文',3),{start:0,end:3,query:'中文'});
  assert.equal(skillQuery('https://example',15),null);
  assert.equal(skillQuery('/tmp/file',9),null);
  assert.equal(skillQuery('普通文字',4),null);
});
import {mentionRanges} from '../public/inline-mentions.js';
const refs=[{kind:'skills',key:'/one',token:'$create'},{kind:'skills',key:'/two',token:'$create-more'},{kind:'plugins',key:'plugin',token:'@tools'}];
test('references follow the current message, not a sticky selection',()=>{
 assert.deepEqual(mentionRanges('请用 $create 然后 @tools。',refs).map(r=>r.key),['/one','plugin']);
 assert.deepEqual(mentionRanges('',refs),[]);
 assert.deepEqual(mentionRanges('请用 $creat',refs),[]);
 assert.deepEqual(mentionRanges('$create-more!',refs).map(r=>r.key),['/two']);
 assert.deepEqual(mentionRanges('path/$create',refs),[]);
});
test('multiple mentions and repeated references keep their exact positions',()=>{
 const value='$create 和 $create';
 assert.deepEqual(mentionRanges(value,refs).map(r=>value.slice(r.start,r.end)),['$create','$create']);
});
test('sentence punctuation keeps a skill mention active',()=>{
 assert.deepEqual(mentionRanges('Use $create.',refs).map(r=>r.key),['/one']);
});
import {matchingSkills,skillPresentation} from '../public/skill-suggestions.js';
test('skill names and native display names rank ahead of description-only matches',()=>{
 const rows=[{name:'dingtalk',description:'MultiSkill',path:'/a',enabled:true},{name:'multica-cli',path:'/b',enabled:true,interface:{displayName:'Multica CLI',shortDescription:'Operate Multica'}},{name:'media',path:'/c',enabled:true,interface:{displayName:'Music to Video'}},{name:'disabled',path:'/d',enabled:false,description:'mu'}];
 assert.deepEqual(matchingSkills(rows,'mu').map(e=>e.path),['/b','/c','/a']);
 assert.deepEqual(matchingSkills(rows,'multica cli').map(e=>e.path),['/b']);
 assert.deepEqual(skillPresentation(rows[1]),{name:'Multica CLI',description:'Operate Multica',source:''});
});
test('deduplicate only identical paths and preserve native selection identities',()=>{
 const a={name:'same',path:'/one/SKILL.md',enabled:true,scope:'user'},b={...a,path:'/two/SKILL.md',scope:'repo'};
 assert.deepEqual(matchingSkills([a,a,b],''),[a,b]);assert.equal(skillPresentation(a).source,'个人');assert.equal(skillPresentation(b).source,'项目');
 assert.equal(skillPresentation({...a,shortDescription:'short',description:'long'}).description,'short');
});

import {pluginQuery,matchingPlugins} from '../public/skill-suggestions.js';
test('at completion matches the caret query but excludes emails and paths',()=>{
 assert.deepEqual(pluginQuery('请用 @ima 后续',7),{start:3,end:7,query:'ima',kind:'plugins'});
 assert.equal(pluginQuery('hello@example.com',17),null);
 assert.equal(pluginQuery('/path/@plugin',13),null);
 assert.equal(pluginQuery('@one/two',8),null);
 assert.equal(pluginQuery('@',1).query,'');
});
test('plugin completion uses native IDs, display names and enabled installed entries',()=>{
 const a={id:'image@market',name:'image',enabled:true,installed:true,interface:{displayName:'Image Gen',shortDescription:'Generate images'}};
 const b={...a,id:'other@market',name:'other',interface:{displayName:'Other'}};
 assert.deepEqual(matchingPlugins([a,a,b,{...a,id:'off',enabled:false},{...a,id:'new',installed:false}],'ima').map(e=>e.id),[a.id]);
 assert.deepEqual(matchingPlugins([a,b],'').map(e=>e.id),[a.id,b.id]);
});
