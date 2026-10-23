import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheKey,recoveryDetail,readDetailCache,writeDetailCache} from '../public/detail-cache.js';
import {mergeLiveTurns} from '../public/connection-state.js';
test('cached recovery is machine isolated, non-authoritative and preserves repeated lines',()=>{
 assert.notEqual(cacheKey('local','same'),cacheKey('remote-b','same'));
 const old={thread:{id:'t'},controlled:true,pendingRequests:[{id:1}],turns:[{id:'turn',items:[{id:'cmd',aggregatedOutput:'first\nsame\nsame\n'}]}]};
 const cached=recoveryDetail(old);assert.equal(cached.controlled,false);assert.equal(cached.recovering,true);assert.deepEqual(cached.pendingRequests,[]);
 const incoming=[{id:'turn',items:[{id:'cmd',aggregatedOutput:'first\nsame\nsame\n中间😀\nend\n'}]}];
 assert.equal(mergeLiveTurns(cached.turns,incoming)[0].items[0].aggregatedOutput,incoming[0].items[0].aggregatedOutput);
 assert.equal(mergeLiveTurns(incoming,cached.turns)[0].items[0].aggregatedOutput,incoming[0].items[0].aggregatedOutput);
});
test('unavailable browser storage never prevents network recovery',async()=>{
 assert.equal(await readDetailCache('local','t'),null);await writeDetailCache('local','t',{thread:{id:'t'}});
});

test('incremental recovery applies once against exact base and rejects mismatches',async()=>{
 const {outputBases,hydrateOutputs}=await import('../public/detail-cache.js');
 const before=[{id:'t',items:[{id:'c',outputToken:'old',aggregatedOutput:'开头😀\nsame\nsame\n'}]}];
 const reply=()=>({turns:[{id:'t',items:[{id:'c',outputBaseToken:'old',outputToken:'new',outputDelta:'中间\nsame\n'}]}]});
 const data=hydrateOutputs(reply(),outputBases(before));
 assert.equal(data.turns[0].items[0].aggregatedOutput,'开头😀\nsame\nsame\n中间\nsame\n');
 assert.equal(hydrateOutputs(data,outputBases(before)).turns[0].items[0].aggregatedOutput,data.turns[0].items[0].aggregatedOutput);
 assert.throws(()=>hydrateOutputs(reply(),new Map()),/快照已变化/);
 const merged=mergeLiveTurns(data.turns,before);assert.equal(merged[0].items[0].outputToken,'new');
});
test('packed full output and delta preserve Unicode, repeated lines and exact hydration',async()=>{
 const {gzipSync}=await import('node:zlib');const {decodeOutputs,outputBases,hydrateOutputs}=await import('../public/detail-cache.js');
 const prefix='开头😀\n'+'重复行\n'.repeat(20000),suffix='中间😀\n'+'重复行\n'.repeat(20000)+'末尾\n';
 const pack=(field,text)=>({field,data:gzipSync(text).toString('base64')});
 const first=await decodeOutputs({turns:[{id:'t',items:[{id:'i',outputToken:'first',outputCompressed:pack('aggregatedOutput',prefix)}]}]});
 assert.equal(first.turns[0].items[0].aggregatedOutput,prefix);
 const next=hydrateOutputs(await decodeOutputs({turns:[{id:'t',items:[{id:'i',outputBaseToken:'first',outputToken:'last',outputCompressed:pack('outputDelta',suffix)}]}]}),outputBases(first.turns));
 assert.equal(next.turns[0].items[0].aggregatedOutput,prefix+suffix);assert.equal(next.turns[0].items[0].outputCompressed,undefined);
 await assert.rejects(decodeOutputs({turns:[{items:[{outputCompressed:{field:'text',data:''}}]}]}),/字段无效/);
 await assert.rejects(decodeOutputs({turns:[{items:[{outputCompressed:{field:'aggregatedOutput',data:'bad'}}]}]}));
});
