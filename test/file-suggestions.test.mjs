import test from 'node:test';
import assert from 'node:assert/strict';
import {fileSuggestions} from '../lib/file-suggestions.mjs';
import {fileReferenceText} from '../src/web/services/composer.ts';
function fixture(files=[]){const calls=[];const m={generation:1,requireConnected(){},rpc:{async request(...args){calls.push(args);return {files};}}};return {m,calls};}
test('file search uses target RPC and preserves distinct paths with identical names',async()=>{
 const file=path=>({root:'/project',path,file_name:'same.ts',match_type:'file'});
 const {m,calls}=fixture([file('a/same.ts'),file('b/same.ts'),file('a/same.ts'),file('../outside'),file('.git/config'),{...file('folder'),match_type:'directory'},{...file('other'),root:'/other'}]);
 const result=await fileSuggestions(m,'/project','same');
 assert.deepEqual(calls[0],['fuzzyFileSearch',{query:'same',roots:['/project'],cancellationToken:null},{timeoutMs:10000}]);
 assert.deepEqual(result.data.map(e=>e.path),['/project/a/same.ts','/project/b/same.ts','/project/folder/']);
 assert.equal(result.data[0].mentionKind,'files');
});
test('empty query avoids native scans; invalid input is rejected',async()=>{
 const {m,calls}=fixture();assert.deepEqual(await fileSuggestions(m,'/project',''),{data:[]});assert.equal(calls.length,0);
 await assert.rejects(fileSuggestions(m,null,'a'));await assert.rejects(fileSuggestions(m,'relative','a'));await assert.rejects(fileSuggestions(m,'/project','x'.repeat(257)));
});
test('native errors and connection changes cannot become successful results',async()=>{
 const {m}=fixture();m.rpc.request=async()=>{throw Error('unsupported')};await assert.rejects(fileSuggestions(m,'/project','a'),/unsupported/);
 m.rpc.request=async()=>{m.generation++;return {files:[]}};await assert.rejects(fileSuggestions(m,'/project','a'),/连接已变化/);
});
test('file paths remain unambiguous plain native text, including spaces and quotes',()=>{
 for(const path of ['/project/a.ts','/project/中文 文件.ts','/project/a"b.ts'])assert.equal(JSON.parse(fileReferenceText(path)),path);
});
import {composerCatalog,referenceInputs} from '../lib/composer.mjs';
test('apps paginate and only enabled accessible IDs can be sent as native mentions',async()=>{
 const {m}=fixture();m.requireCapability=()=>{};
 m.rpc.request=async(method,params)=>{assert.equal(method,'app/list');return params.cursor?{data:[{id:'enabled',name:'Example',isAccessible:true,isEnabled:true}],nextCursor:null}:{data:[{id:'off',isAccessible:true,isEnabled:false}],nextCursor:'next'};};
 assert.equal((await composerCatalog(m,'/project','apps')).apps.data.length,2);
 assert.deepEqual(await referenceInputs(m,'/project',{apps:['enabled']}),[{type:'mention',name:'Example',path:'app://enabled'}]);
 await assert.rejects(referenceInputs(m,'/project',{apps:['off']}),/不可用/);
 await assert.rejects(referenceInputs(m,'/project',{apps:'bad'}),/无效/);
});
test('repeated app cursors fail instead of exposing an incomplete catalog',async()=>{
 const {m}=fixture();m.rpc.request=async()=>({data:[],nextCursor:'repeat'});
 assert.match((await composerCatalog(m,'/project','apps')).apps.error,/完整读取/);
});
