import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/server/local-origin.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createLocalOriginMatcher}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const baseline=(port,host)=>[`http://127.0.0.1:${port}`,`http://localhost:${port}`].find(value=>new URL(value).host===host);
test('cached local origins retain baseline exact Host matching, default-port normalization and port changes',()=>{
 const match=createLocalOriginMatcher();
 for(const port of [4317,4317,80,80,4327,4317])for(const host of [undefined,'','localhost','127.0.0.1',`localhost:${port}`,`127.0.0.1:${port}`,'LOCALHOST:4317','localhost:80','localhost:04317','localhost.:4317','localhost:4327','127.0.0.1:4317.attacker.test','localhost:4317@attacker.test','[::1]:4317','attacker.test:4317']) {
  assert.equal(match(port,host),baseline(port,host),JSON.stringify({port,host}));
 }
});
test('local origin cache parses only server addresses and invalid ports still fail closed',t=>{
 const NativeURL=globalThis.URL;let parses=0;
 t.mock.method(globalThis,'URL',class extends NativeURL{constructor(...args){parses++;super(...args);}});
 const match=createLocalOriginMatcher();
 for(let i=0;i<100;i++)assert.equal(match(4327,i%2?'localhost:4327':'forged.test'),i%2?'http://localhost:4327':undefined);
 assert.equal(parses,2);match(4317,'localhost:4317');assert.equal(parses,4);
 assert.throws(()=>match(undefined,'localhost'),{code:'ERR_INVALID_URL'});
 assert.equal(match(4317,'localhost:4317'),'http://localhost:4317');
});
