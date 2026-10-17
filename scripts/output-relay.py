"""Private Unix-socket WebSocket relay; retain output capture across UI disconnects."""
import json, os, pathlib, select, socket, sqlite3, struct, threading, time, uuid, queue
from contextlib import nullcontext
ROOT = pathlib.Path(__file__).parent
UPSTREAM = ROOT / 'app-server.sock'
LISTEN = ROOT / 'output-relay-v2.sock'
DB = ROOT / 'output-journal.sqlite'


def database():
    db = sqlite3.connect(DB, timeout=10)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS commands (thread TEXT, turn TEXT, item TEXT PRIMARY KEY, owner TEXT, value TEXT, updated REAL)')
    db.execute('CREATE TABLE IF NOT EXISTS output_chunks (seq INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, delta TEXT)')
    db.execute('CREATE INDEX IF NOT EXISTS output_chunks_item ON output_chunks(item,seq)')
    db.execute('CREATE TABLE IF NOT EXISTS startup_prefixes (item TEXT PRIMARY KEY, prefix TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS notification_events (event_key TEXT PRIMARY KEY, thread TEXT, observed REAL, event TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS turn_owners (thread TEXT PRIMARY KEY, owner TEXT)')
    db.commit()
    return db


_capture_started = set()
_capture_lock = threading.Lock()

def capture_startup(thread, turn, item, process):
    # Capture independently of the browser, including a disconnect at startup.
    with _capture_lock:
        if item in _capture_started: return
        _capture_started.add(item)
    def run():
        try:
            source = (ROOT / 'output-reader.py').read_text()
            namespace = {'__name__':'output_reader','STORE_HOME':str(ROOT.parent.parent)}
            exec(compile(source,'output-reader.py','exec'),namespace)
            key = (turn,str(process))
            for _ in range(120):
                found = namespace['startup_outputs'](thread,{key})
                if key in found:
                    db=database()
                    with db: db.execute('INSERT OR IGNORE INTO startup_prefixes VALUES (?,?)',(item,found[key]))
                    db.close(); return
                time.sleep(.25)
        except (OSError, sqlite3.Error, ValueError):
            pass
    threading.Thread(target=run,daemon=True).start()


def record(db, owner, event, batch=False):
    method, p = event.get('method'), event.get('params') or {}
    goal=p.get('goal') or {};turn=p.get('turn') or {}
    identity=None
    if method=='thread/goal/updated' and goal.get('status') in ('complete','blocked','usageLimited','budgetLimited'):
        identity=['goal',goal.get('createdAt'),goal.get('objective'),goal.get('status')]
    elif method=='turn/completed' and turn.get('status')=='failed':
        identity=['failure',turn.get('id')]
    if identity and p.get('threadId'):
        key=json.dumps([p['threadId']]+identity,ensure_ascii=False)
        with db: db.execute('INSERT OR IGNORE INTO notification_events VALUES (?,?,?,?)',(key,p['threadId'],time.time(),json.dumps(event,ensure_ascii=False)))
        return
    item = p.get('item') or {}
    is_item = method in ('item/started', 'item/completed') and item.get('type') == 'commandExecution'
    is_delta = method == 'item/commandExecution/outputDelta'
    if not (is_item or is_delta): return
    identifier = item.get('id') if is_item else p.get('itemId')
    if not identifier or not p.get('threadId') or not p.get('turnId'): return
    with (nullcontext() if batch else db):
        if not db.in_transaction: db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT owner,value FROM commands WHERE item=?', (identifier,)).fetchone()
        # Pin capture to the connection that sends turn/start, before forwarding it.
        # A resumed subscriber can receive its first delta later in the stream.
        origin = db.execute('SELECT owner FROM turn_owners WHERE thread=?', (p['threadId'],)).fetchone()
        writer = origin[0] if origin else row[0] if row else ''
        if writer and writer != owner and is_delta: return
        value = json.loads(row[1]) if row else {'id':identifier,'type':'commandExecution','status':'inProgress','aggregatedOutput':''}
        if is_delta:
            db.execute('INSERT INTO output_chunks(item,delta) VALUES (?,?)',(identifier,p.get('delta') or ''))
        else:
            output = value.get('aggregatedOutput') or ''
            captured = db.execute('SELECT COALESCE(SUM(length(delta)),0) FROM output_chunks WHERE item=?',(identifier,)).fetchone()[0]
            value.update(item)
            # Completion snapshots may be truncated. Keep captured chunks intact.
            if len(output)+captured > len(value.get('aggregatedOutput') or ''):
                value['aggregatedOutput'] = output
            else:
                db.execute('DELETE FROM output_chunks WHERE item=?',(identifier,))
        db.execute('INSERT OR REPLACE INTO commands VALUES (?,?,?,?,?,?)', (p['threadId'],p['turnId'],identifier,(writer or (owner if is_delta else '')),json.dumps(value,ensure_ascii=False),time.time()))
    if is_item and method == 'item/started' and item.get('processId'):
        capture_startup(p['threadId'],p['turnId'],identifier,item['processId'])


class JournalWriter:
    """Drain upstream promptly; disk commits must not block WebSocket reads."""
    def __init__(self, owner):
        self.owner=owner; self.events=queue.SimpleQueue(); self.error=None
        self.thread=threading.Thread(target=self.run,daemon=True);self.thread.start()
    def put(self,event):
        if self.error: raise RuntimeError('Output journal writer failed') from self.error
        self.events.put(event)
    def run(self):
        db=None
        try:
            db=database()
            while True:
                first=self.events.get()
                if first is None: break
                batch=[first];done=False
                for _ in range(127):
                    try: event=self.events.get_nowait()
                    except queue.Empty: break
                    if event is None: done=True;break
                    batch.append(event)
                with db:
                    db.execute('BEGIN IMMEDIATE')
                    for event in batch:record(db,self.owner,event,batch=True)
                if done:break
        except Exception as error:self.error=error
        finally:
            if db:db.close()
    def close(self):
        self.events.put(None);self.thread.join()
        if self.error: raise RuntimeError('Output journal writer failed') from self.error

class ClientWriter:
    """A slow browser must never stop durable command capture."""
    def __init__(self, client):
        self.client=client;self.chunks=queue.Queue(256);self.failed=threading.Event()
        self.thread=threading.Thread(target=self.run,daemon=True);self.thread.start()
    def fail(self):
        self.failed.set()
        try:self.client.shutdown(socket.SHUT_RDWR)
        except OSError:pass
    def put(self,data):
        if self.failed.is_set():return
        try:self.chunks.put_nowait(data)
        except queue.Full:self.fail()
    def run(self):
        while True:
            data=self.chunks.get()
            if data is None:return
            if self.failed.is_set():continue
            try:self.client.sendall(data)
            except OSError:self.fail()
    def close(self):
        self.fail()
        # Discard unsent browser frames; authoritative output stays in journal.
        while True:
            try:self.chunks.get_nowait()
            except queue.Empty:break
        self.chunks.put_nowait(None)


class Frames:
    def __init__(self): self.buffer = b''; self.fragments = b''
    def feed(self, data):
        self.buffer += data
        while len(self.buffer) >= 2:
            b = self.buffer; size = b[1] & 127; pos = 2
            if size == 126:
                if len(b) < 4: return
                size = struct.unpack('!H', b[2:4])[0]; pos = 4
            elif size == 127:
                if len(b) < 10: return
                size = struct.unpack('!Q', b[2:10])[0]; pos = 10
            masked = bool(b[1] & 128)
            if len(b) < pos + (4 if masked else 0) + size: return
            mask = b[pos:pos+4] if masked else None
            if masked: pos += 4
            payload = b[pos:pos+size]; self.buffer = b[pos+size:]
            if mask: payload = bytes(v ^ mask[i % 4] for i,v in enumerate(payload))
            opcode = b[0] & 15
            if opcode in (0,1):
                self.fragments += payload
                if b[0] & 128:
                    payload = self.fragments; self.fragments = b''
                    yield 1, payload
            elif opcode in (8,9,10): yield opcode,payload


def masked_frame(opcode, payload):
    mask = os.urandom(4); n = len(payload)
    header = bytes([128 | opcode,128 | n]) if n < 126 else bytes([128 | opcode,254])+struct.pack('!H',n) if n < 65536 else bytes([128 | opcode,255])+struct.pack('!Q',n)
    return header + mask + bytes(v ^ mask[i % 4] for i,v in enumerate(payload))


def header(sock):
    data = b''
    while b'\r\n\r\n' not in data:
        part = sock.recv(4096)
        if not part: raise ConnectionError('Incomplete handshake')
        data += part
        if len(data) > 65536: raise ValueError('Handshake too large')
    return data.split(b'\r\n\r\n',1)


def relay(client):
    upstream = socket.socket(socket.AF_UNIX); db = database(); owner = uuid.uuid4().hex
    server_frames, client_frames = Frames(), Frames()
    turns, commands = set(), set()
    journal=JournalWriter(owner);forward=None
    try:
        client.settimeout(15); upstream.settimeout(15); upstream.connect(str(UPSTREAM))
        request, extra = header(client)
        # No compression: inspect exact UTF-8 notifications without extension state.
        request = b'\r\n'.join(line for line in request.split(b'\r\n') if not line.lower().startswith(b'sec-websocket-extensions:'))
        upstream.sendall(request+b'\r\n\r\n'+extra)
        response, initial = header(upstream); client.sendall(response+b'\r\n\r\n')
        forward=ClientWriter(client)
        def consume(data):
            for opcode,payload in server_frames.feed(data):
                if opcode == 9:
                    # Relay owns ping/pong even after the browser transport closes.
                    upstream.sendall(masked_frame(10,payload))
                if opcode != 1: continue
                event = json.loads(payload); p = event.get('params') or {}; method = event.get('method')
                if method == 'turn/started': turns.add((p.get('turn') or {}).get('id'))
                if method == 'turn/completed': turns.discard((p.get('turn') or {}).get('id'))
                item = p.get('item') or {}
                if item.get('type') == 'commandExecution':
                    if method == 'item/started': commands.add(item.get('id'))
                    if method == 'item/completed': commands.discard(item.get('id'))
                if method in ('item/started','item/completed','item/commandExecution/outputDelta','thread/goal/updated','turn/completed'):journal.put(event)
        if initial:
            consume(initial); forward.put(initial)
        while True:
            if client is None and not turns and not commands: break
            ready,_,_ = select.select([upstream]+([client] if client else []),[],[],10)
            for source in ready:
                if source is not upstream and source is not client: continue
                try: data = source.recv(65536)
                except OSError:
                    if source is upstream: raise
                    client.close(); client = None; continue
                if source is upstream:
                    if not data: return
                    consume(data)
                    if client: forward.put(data)
                else:
                    if not data:
                        client.close(); client = None; continue
                    # Do not forward a client close: active capture must survive it.
                    frames = list(client_frames.feed(data))
                    if any(opcode == 8 for opcode,_ in frames):
                        client.close(); client = None; continue
                    for opcode,payload in frames:
                        if opcode == 1:
                            request = json.loads(payload)
                            if request.get('method') == 'turn/start':
                                thread = (request.get('params') or {}).get('threadId')
                                if thread:
                                    with db:
                                        db.execute('INSERT OR REPLACE INTO turn_owners VALUES (?,?)',(thread,owner))
                            upstream.sendall(masked_frame(1,payload))
    except (OSError, ValueError, sqlite3.Error, RuntimeError):
        pass  # Never write command contents or credentials into service logs.
    finally:
        if forward:forward.close()
        if client: client.close()
        upstream.close(); db.close()
        journal.close()


def main():
    os.umask(0o077); ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    db = database(); db.close()
    if LISTEN.exists(): LISTEN.unlink()
    server = socket.socket(socket.AF_UNIX); server.bind(str(LISTEN)); server.listen(32)
    while True:
        client,_ = server.accept()
        threading.Thread(target=relay,args=(client,),daemon=True).start()

if __name__ == '__main__': main()
