// Isolated browser acceptance transport. Never connects to a Manager or engine.
export function createParityEventHandler() {
  const clients = new Map();
  return (req, res, url) => {
    if (!url.pathname.startsWith('/__parity_events')) return false;
    const id = url.searchParams.get('client');
    const action = url.pathname.slice('/__parity_events'.length);
    const json = (status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
    if (!id || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || !['','/disconnect','/recover','/status','/pulse'].includes(action)) { json(400, {error:'Invalid fixture channel'}); return true; }
    if (req.method !== (action && action !== '/status' ? 'POST' : 'GET')) { json(405, {error:'Method not allowed'}); return true; }
    if (action && action !== '/status' && req.headers.origin !== 'http://' + req.headers.host) { json(403, {error:'Fixture controls require same Origin'}); return true; }
    let client = clients.get(id);
    if (!client) { client = {allowed:true, requests:0, opens:0, sequence:0, active:new Set(), pending:new Set()}; clients.set(id, client); }
    const open = response => {
      client.pending.delete(response); client.active.add(response); client.opens++;
      response.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store'});
      response.write('retry: 1000\n: isolated acceptance stream\n\n');
    };
    if (!action) {
      client.requests++;
      res.on('close', () => { client.active.delete(res); client.pending.delete(res); });
      if (client.allowed) open(res); else client.pending.add(res);
    } else {
      if (action === '/disconnect') { client.allowed=false; for (const response of client.active) response.end(); client.active.clear(); }
      if (action === '/recover') { client.allowed=true; for (const response of [...client.pending]) open(response); }
      if (action === '/pulse') { client.sequence++; for (const response of client.active) response.write('event: qa/pulse\ndata: ' + JSON.stringify({sequence:client.sequence}) + '\n\n'); }
      json(200, {...(action === '/pulse' ? {sequence:client.sequence} : {}), allowed:client.allowed, requests:client.requests, opens:client.opens, active:client.active.size, pending:client.pending.size});
    }
    return true;
  };
}
