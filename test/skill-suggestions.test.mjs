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
