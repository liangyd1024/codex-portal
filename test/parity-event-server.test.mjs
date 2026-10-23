import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createParityEventHandler} from './helpers/parity-event-server.mjs';

test('isolated SSE interruption holds reconnect until recovery and rejects foreign controls', async () => {
 const handler=createParityEventHandler();
 const server=http.createServer((req,res)=>{if(!handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port,query='?client=test-channel';
 const control=(action,headers={Origin:origin})=>fetch(origin+'/__parity_events/'+action+query,{method:'POST',headers});
 const abort=new AbortController();
 try {
  const stream=await fetch(origin+'/__parity_events'+query,{signal:abort.signal});
  assert.equal(stream.headers.get('content-type'),'text/event-stream');
  const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/retry: 1000/);
  assert.equal((await control('disconnect',{Origin:'https://other.invalid'})).status,403);
  assert.equal((await control('disconnect')).status,200);
  assert.equal((await reader.read()).done,true);
  const requested=once(server,'request');
  const reconnect=fetch(origin+'/__parity_events'+query,{signal:abort.signal});await requested;
  const state=await (await fetch(origin+'/__parity_events/status'+query)).json();
  assert.deepEqual(state,{allowed:false,requests:2,opens:1,active:0,pending:1});
  assert.equal((await control('recover')).status,200);
  const recovered=await reconnect;
  assert.match(new TextDecoder().decode((await recovered.body.getReader().read()).value),/isolated acceptance stream/);
  const final=await (await fetch(origin+'/__parity_events/status'+query)).json();
  assert.deepEqual(final,{allowed:true,requests:2,opens:2,active:1,pending:0});
 } finally {abort.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
