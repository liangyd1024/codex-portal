import { EventEmitter } from 'node:events';

const has = (value, key) => Object.hasOwn(value, key);
const validId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

function checkTimeout(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive finite number.');
  }
  return timeoutMs;
}

function timeoutError(method, timeoutMs) {
  const error = new Error(`${method} timed out after ${timeoutMs} ms.`);
  error.name = 'RpcTimeoutError';
  error.code = 'RPC_TIMEOUT';
  error.method = method;
  return error;
}

/** One explicit WebSocket connection. Requests are never retried or replayed. */
export class RpcClient extends EventEmitter {
  #WebSocketImpl;
  #timeoutMs;
  #connection = null;
  #nextId = 1;
  #decoder = new TextDecoder('utf-8', { fatal: true });

  constructor({ WebSocketImpl = globalThis.WebSocket, timeoutMs = 30000 } = {}) {
    super();
    this.#WebSocketImpl = WebSocketImpl;
    this.#timeoutMs = checkTimeout(timeoutMs);
    // Callers may add their own listener without risking EventEmitter's fatal default.
    this.on('error', () => {});
  }

  get connected() {
    const connection = this.#connection;
    return Boolean(connection?.initialized && !connection.closing && connection.socket.readyState === 1);
  }

  async connect(url) {
    if (this.#connection) throw new Error('A WebSocket connection already exists.');
    if (typeof this.#WebSocketImpl !== 'function') throw new Error('WebSocket is not available.');

    const socket = new this.#WebSocketImpl(url);
    const connection = {
      socket,
      pending: new Map(),
      initialized: false,
      closing: false,
      closeEmitted: false,
      messageQueue: Promise.resolve(),
      resolveOpen: null,
      rejectOpen: null,
    };
    this.#connection = connection;
    socket.binaryType = 'arraybuffer';

    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError('WebSocket connect', this.#timeoutMs)), this.#timeoutMs);
      connection.resolveOpen = () => {
        clearTimeout(timer);
        connection.resolveOpen = connection.rejectOpen = null;
        resolve();
      };
      connection.rejectOpen = (error) => {
        clearTimeout(timer);
        connection.resolveOpen = connection.rejectOpen = null;
        reject(error);
      };
    });

    socket.addEventListener('open', () => connection.resolveOpen?.());
    socket.addEventListener('message', ({ data }) => {
      connection.messageQueue = connection.messageQueue
        .then(async () => {
          if (this.#connection !== connection || connection.closing) return;
          const text = await this.#messageText(data);
          if (this.#connection === connection && !connection.closing) this.#handleMessage(connection, text);
        })
        .catch((error) => this.emit('error', error instanceof Error ? error : new Error('WebSocket message failed.')));
    });
    socket.addEventListener('error', (event) => {
      if (this.#connection !== connection || connection.closing) return;
      const cause = event.error instanceof Error ? event.error : undefined;
      // Node can emit an AggregateError with an empty message. Always identify
      // the transport so the manager can report it and apply bounded retries.
      const detail = cause?.message?.trim() || cause?.cause?.code || cause?.code ||
        (cause instanceof AggregateError ? cause.errors.find(item => item?.code || item?.message)?.code : '') || '';
      const error = new Error('WebSocket transport failed' + (detail ? ': ' + detail : '.'), {cause});
      error.code = 'WEBSOCKET_TRANSPORT';
      this.emit('error', error);
      this.#shutdown(connection, error);
    });
    socket.addEventListener('close', (event) => this.#handleClose(connection, event));
    // A test double or an existing-open transport may already be ready.
    if (socket.readyState === 1) connection.resolveOpen?.();

    try {
      await opened;
      if (connection.closing) throw new Error('WebSocket connection closed.');
      const result = await this.#request(connection, 'initialize', {
        clientInfo: {
          name: 'remote_codex_manager',
          title: 'Codex Portal',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true },
      }, this.#timeoutMs);
      this.#send(connection, { method: 'initialized', params: {} });
      connection.initialized = true;
      return result;
    } catch (error) {
      this.#shutdown(connection, error);
      throw error;
    }
  }

  async request(method, params = {}, options = {}) {
    if (!this.connected) throw new Error('Codex app-server is not connected.');
    return this.#request(this.#connection, method, params, checkTimeout(options.timeoutMs ?? this.#timeoutMs));
  }

  respond(id, result) {
    if (!validId(id)) throw new TypeError('Response id must be a string or number.');
    this.#send(this.#connection, { id, result });
  }

  respondError(id, { code, message }) {
    if (!validId(id)) throw new TypeError('Response id must be a string or number.');
    if (!Number.isFinite(code) || typeof message !== 'string') throw new TypeError('Invalid RPC error.');
    this.#send(this.#connection, { id, error: { code, message } });
  }

  notify(method, params = {}) {
    this.#send(this.#connection, { method, params });
  }

  close() {
    if (this.#connection) this.#shutdown(this.#connection, new Error('WebSocket connection closed by client.'));
  }

  #send(connection, message) {
    if (!connection || connection.closing || connection.socket.readyState !== 1) {
      throw new Error('Codex app-server is not connected.');
    }
    connection.socket.send(JSON.stringify(message));
  }

  #request(connection, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        reject(timeoutError(method, timeoutMs));
      }, timeoutMs);
      connection.pending.set(id, { resolve, reject, timer });
      try {
        this.#send(connection, { id, method, params });
      } catch (error) {
        clearTimeout(timer);
        connection.pending.delete(id);
        reject(error);
      }
    });
  }

  async #messageText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return this.#decoder.decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) {
      return this.#decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return this.#decoder.decode(new Uint8Array(await data.arrayBuffer()));
    }
    throw new Error('Unsupported WebSocket message type.');
  }

  #handleMessage(connection, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.emit('error', new Error('Received invalid JSON from Codex app-server.'));
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.emit('error', new Error('Received an invalid RPC message.'));
      return;
    }
    if (typeof message.method === 'string') {
      if (!has(message, 'id')) {
        this.emit('notification', { method: message.method, params: message.params ?? {} });
      } else if (validId(message.id)) {
        this.emit('serverRequest', { id: message.id, method: message.method, params: message.params ?? {} });
      } else {
        this.emit('error', new Error('Received an invalid server request id.'));
      }
      return;
    }
    if (!validId(message.id)) {
      this.emit('error', new Error('Received an RPC response without a valid id.'));
      return;
    }
    const pending = connection.pending.get(message.id);
    // A late response to a timed-out request must not complete a later request.
    if (!pending) return;
    connection.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (has(message, 'result') === has(message, 'error')) {
      const error = new Error('Received an invalid RPC response.');
      pending.reject(error);
      this.emit('error', error);
    } else if (has(message, 'error')) {
      const error = new Error(typeof message.error?.message === 'string' ? message.error.message : 'Codex RPC request failed.');
      error.name = 'RpcError';
      error.code = message.error?.code;
      if (has(message.error ?? {}, 'data')) error.data = message.error.data;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  #rejectPending(connection, error) {
    for (const { reject, timer } of connection.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    connection.pending.clear();
  }

  #shutdown(connection, error) {
    if (connection.closing) return;
    connection.closing = true;
    connection.initialized = false;
    connection.rejectOpen?.(error);
    this.#rejectPending(connection, error);
    try {
      connection.socket.close();
    } catch {
      this.#handleClose(connection, { code: 1006, reason: 'Transport closed.' });
    }
  }

  #handleClose(connection, { code = 1006, reason = '' }) {
    connection.closing = true;
    connection.initialized = false;
    const error = new Error(`WebSocket connection closed (${code}${reason ? `: ${reason}` : ''}).`);
    connection.rejectOpen?.(error);
    this.#rejectPending(connection, error);
    if (this.#connection === connection) this.#connection = null;
    if (!connection.closeEmitted) {
      connection.closeEmitted = true;
      this.emit('close', { code, reason: String(reason) });
    }
  }
}
