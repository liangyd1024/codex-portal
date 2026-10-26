import test from 'node:test';
import assert from 'node:assert/strict';
import {referencedLine} from '../src/web/services/file-preview-text.ts';

test('reference offsets preserve CRLF, blank lines and the final line without modifying content',()=>{
 const text='一\r\n\nconst sample = 1;';
 for(const [line,expected] of [[1,'一\r'],[2,''],[3,'const sample = 1;']]){
  const range=referencedLine(text,line);assert.equal(text.slice(range.start,range.end),expected);
 }
 assert.equal(referencedLine(text,4),null);
 for(const invalid of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(referencedLine(text,invalid),null);
 assert.deepEqual(referencedLine('',1),{start:0,end:0});
 assert.deepEqual(referencedLine('x\n',2),{start:2,end:2});
});
