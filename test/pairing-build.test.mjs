import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

test('standalone pairing script reaches its mount without Node globals or module loading',async()=>{
 const root=path.resolve(import.meta.dirname,'..');
 const manifest=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
 const script=await readFile(path.join(manifest.output,'public/login.js'),'utf8');
 const mounted=new Error('mount reached');
 // Stop before hydration: the browser suite verifies the DOM and pairing flow.
 // A dependency on process, require, or external imports fails before this sentinel.
 assert.throws(()=>vm.runInNewContext(script,{document:{querySelector(selector){
  assert.equal(selector,'main.pairing-page');throw mounted;
 }}},{timeout:1000}),error=>error===mounted);
});
