import test from 'node:test';
import assert from 'node:assert/strict';
import {outputWindow,OUTPUT_WINDOW_SIZE} from '../public/output-window.js';
test('large output remains accessible in bounded pages including its middle',()=>{
 const text='BEGIN\n'+'x'.repeat(12*1024*1024)+'\nEND';let pos=0,joined='';
 while(pos<text.length){const p=outputWindow(text,pos);assert.ok(p.text.length<=OUTPUT_WINDOW_SIZE);if(p.start<pos){joined+=p.text.slice(pos-p.start);pos=p.end;}else{joined+=p.text;pos=p.end;}}
 assert.equal(joined,text);assert.equal(outputWindow(text,0).text.slice(0,6),'BEGIN\n');assert.ok(outputWindow(text).text.endsWith('END'));
 const middle=outputWindow(text,5000000);assert.equal(middle.start,5000000);assert.equal(middle.text,text.slice(5000000,5000000+OUTPUT_WINDOW_SIZE));
});
test('pinned output does not jump on new output; following tail advances',()=>{
 const before='a'.repeat(100000),after=before+'b'.repeat(1000);
 assert.equal(outputWindow(before,0).text,outputWindow(after,0).text);
 assert.equal(outputWindow(after).end,after.length);
 assert.ok(!outputWindow('a😀b',2,1).text.includes('\uFFFD'));
});
