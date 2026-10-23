import assert from 'node:assert/strict';
import { setImmediate as nextTick } from 'node:timers/promises';
import { test } from 'node:test';
import { RpcClient } from '../lib/rpc-client.mjs';

class FakeWebSocket extends EventTarget {
  static instances = [];
  readyState = 0;
  sent = [];
  closeCalls = 0;

  constructor(url) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  send(value) {
    assert.equal(this.readyState, 1);
    this.sent.push(JSON.parse(value));
  }

  receive(data) {
    const event = new Event('message');
    event.data = typeof data === 'object' && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && !(data instanceof Blob)
      ? JSON.stringify(data) : data;
    this.dispatchEvent(event);
  }

  remoteClose(code = 1006, reason = 'Connection lost') {
    this.readyState = 3;
    const event = new Event('close');
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }

  close() {
    this.closeCalls++;
    this.remoteClose(1000, 'Client closed');
  }

  fail(error = new Error('Transport failure')) {
    const event = new Event('error');
    event.error = error;
    this.dispatchEvent(event);
  }
}

async function connectClient(options = {}) {
  const client = new RpcClient({ WebSocketImpl: FakeWebSocket, ...options });
  const connecting = client.connect('ws://127.0.0.1:9876');
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await nextTick();
  const request = socket.sent[0];
  socket.receive({ id: request.id, result: { userAgent: 'codex/0.162', codexHome: '/Users/example/.codex' } });
  await connecting;
  return { client, socket };
}

test('initialize completes before initialized and before connected becomes true', async () => {
  const client = new RpcClient({ WebSocketImpl: FakeWebSocket });
  const connecting = client.connect('ws://127.0.0.1:9876');
  const socket = FakeWebSocket.instances.at(-1);
  assert.equal(client.connected, false);
  assert.deepEqual(socket.sent, []);
  socket.open();
  await nextTick();
  assert.equal(client.connected, false);
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(socket.sent[0].params, {
    clientInfo: { name: 'remote_codex_manager', title: 'Remote Codex Manager', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  await assert.rejects(client.request('thread/list'), /not connected/);
  const result = { userAgent: 'codex/0.162', platformOs: 'macos' };
  socket.receive({ id: socket.sent[0].id, result });
  assert.deepEqual(await connecting, result);
  assert.deepEqual(socket.sent[1], { method: 'initialized', params: {} });
  assert.equal(client.connected, true);
  client.close();
});

test('out-of-order responses complete only their matching requests', async () => {
  const { client, socket } = await connectClient();
  const first = client.request('thread/read', { threadId: 'first' });
  const second = client.request('thread/read', { threadId: 'second' });
  const [firstRequest, secondRequest] = socket.sent.slice(-2);
  socket.receive({ id: secondRequest.id, result: { thread: 'second' } });
  socket.receive({ id: firstRequest.id, result: { thread: 'first' } });
  assert.deepEqual(await first, { thread: 'first' });
  assert.deepEqual(await second, { thread: 'second' });
  client.close();
});

test('approval requests and responses preserve numeric and string ids', async () => {
  const { client, socket } = await connectClient();
  const requests = [];
  const notifications = [];
  client.on('serverRequest', (request) => requests.push(request));
  client.on('notification', (notification) => notifications.push(notification));
  socket.receive({ id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 'a' } });
  socket.receive({ id: '7', method: 'item/fileChange/requestApproval', params: { threadId: 'b' } });
  socket.receive({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  await nextTick();
  assert.equal(requests[0].id, 7);
  assert.equal(requests[1].id, '7');
  assert.equal(notifications[0].method, 'turn/completed');
  client.respond(requests[0].id, { decision: 'accept' });
  client.respondError(requests[1].id, { code: -32601, message: 'Unsupported client tool' });
  assert.deepEqual(socket.sent.slice(-2), [
    { id: 7, result: { decision: 'accept' } },
    { id: '7', error: { code: -32601, message: 'Unsupported client tool' } },
  ]);
  client.close();
});

test('close rejects every pending request and sends nothing again', async () => {
  const { client, socket } = await connectClient();
  const closed = [];
  client.on('close', (event) => closed.push(event));
  const first = assert.rejects(client.request('turn/start'), /closed/);
  const second = assert.rejects(client.request('thread/read'), /closed/);
  const sentBeforeClose = socket.sent.length;
  socket.remoteClose(1006, 'Lost connection');
  await Promise.all([first, second]);
  assert.equal(client.connected, false);
  assert.deepEqual(closed, [{ code: 1006, reason: 'Lost connection' }]);
  await assert.rejects(client.request('turn/start'), /not connected/);
  assert.throws(() => client.notify('something'), /not connected/);
  assert.equal(socket.sent.length, sentBeforeClose);
});

test('request timeout discards a late response without disturbing later requests', async () => {
  const { client, socket } = await connectClient();
  const timedOut = client.request('thread/read', { threadId: 'slow' }, { timeoutMs: 15 });
  const expiredId = socket.sent.at(-1).id;
  await assert.rejects(timedOut, (error) => error.code === 'RPC_TIMEOUT' && error.method === 'thread/read');
  const later = client.request('thread/read', { threadId: 'later' });
  const currentId = socket.sent.at(-1).id;
  socket.receive({ id: expiredId, result: { stale: true } });
  socket.receive({ id: currentId, result: { current: true } });
  assert.deepEqual(await later, { current: true });
  assert.equal(client.connected, true);
  client.close();
});

test('binary messages decode and separate malformed messages are never joined', async () => {
  const { client, socket } = await connectClient();
  const errors = [];
  const notices = [];
  client.on('error', (error) => errors.push(error));
  client.on('notification', (notification) => notices.push(notification));
  const text = JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: '你好' } });
  socket.receive(new TextEncoder().encode(text).buffer);
  socket.receive(new Blob([text]));
  socket.receive('{"method":');
  socket.receive('"broken"}');
  const response = client.request('thread/list');
  socket.receive(new TextEncoder().encode(JSON.stringify({ id: socket.sent.at(-1).id, result: { data: [] } })));
  assert.deepEqual(await response, { data: [] });
  assert.deepEqual(notices.map((notice) => notice.params.delta), ['你好', '你好']);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => /invalid JSON/.test(error.message)));
  client.close();
});

test('initialize timeout closes the socket and emits no initialized notification', async () => {
  const client = new RpcClient({ WebSocketImpl: FakeWebSocket, timeoutMs: 15 });
  const connecting = client.connect('ws://127.0.0.1:9876');
  const rejected = assert.rejects(connecting, (error) => error.code === 'RPC_TIMEOUT' && error.method === 'initialize');
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await rejected;
  assert.equal(socket.closeCalls, 1);
  assert.equal(client.connected, false);
  assert.deepEqual(socket.sent.map((message) => message.method), ['initialize']);
});

test('opening timeout cleans up a socket that never opens', async () => {
  const client = new RpcClient({ WebSocketImpl: FakeWebSocket, timeoutMs: 15 });
  const connecting = client.connect('ws://127.0.0.1:9876');
  const socket = FakeWebSocket.instances.at(-1);
  await assert.rejects(connecting, (error) => error.code === 'RPC_TIMEOUT');
  assert.equal(socket.closeCalls, 1);
  assert.deepEqual(socket.sent, []);
});

test('remote RPC errors retain code and data, and error events have a default listener', async () => {
  const { client, socket } = await connectClient();
  socket.receive('malformed JSON');
  const request = client.request('thread/resume');
  socket.receive({ id: socket.sent.at(-1).id, error: { code: -32600, message: 'active writer', data: { retry: false } } });
  await assert.rejects(request, (error) => error.code === -32600 && error.message === 'active writer' && error.data.retry === false);
  client.close();
});

test('transport errors close the socket and reject pending requests', async () => {
  const { client, socket } = await connectClient();
  const errors = [];
  client.on('error', (error) => errors.push(error));
  const request = assert.rejects(client.request('thread/list'), /Transport failure/);
  socket.fail();
  await request;
  assert.equal(errors.length, 1);
  assert.equal(client.connected, false);
  assert.equal(socket.closeCalls, 1);
});

test('initialize RPC rejection cleans up and does not mark the connection ready', async () => {
  const client = new RpcClient({ WebSocketImpl: FakeWebSocket });
  const connecting = client.connect('ws://127.0.0.1:9876');
  const rejected = assert.rejects(connecting, (error) => error.code === -32600);
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  await nextTick();
  socket.receive({ id: socket.sent[0].id, error: { code: -32600, message: 'Initialization refused' } });
  await rejected;
  assert.equal(socket.closeCalls, 1);
  assert.equal(client.connected, false);
  assert.deepEqual(socket.sent.map((message) => message.method), ['initialize']);
});

for (const cause of [new Error(''), new AggregateError([Object.assign(new Error(''),{code:'ECONNRESET'})],'')]) {
  test('empty transport errors retain a visible retryable reason during initialization: '+cause.name,async()=>{
    const client = new RpcClient({WebSocketImpl:FakeWebSocket,timeoutMs:100});
    const connecting = client.connect('ws://local');
    const socket = FakeWebSocket.instances.at(-1);
    const rejected = assert.rejects(connecting,error=>error.code==='WEBSOCKET_TRANSPORT' && /WebSocket transport failed/.test(error.message) && error.cause===cause);
    socket.open(); await nextTick(); socket.fail(cause);
    await rejected; assert.equal(client.connected,false); assert.equal(socket.closeCalls,1);
  });
}
