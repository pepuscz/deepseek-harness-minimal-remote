import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteProxy, validateOrigin } from '../proxy.js';
import { apply } from '../index.js';

async function fixture(t, handle) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-connector-test-'));
  const tokenFile = join(dir, 'token');
  await writeFile(tokenFile, 'test-token', { mode: 0o600 });
  const origin = http.createServer((req, res) => {
    if (req.url === '/?token=test-token') {
      res.writeHead(303, { 'set-cookie': 'dsh-auth-test=fixture; HttpOnly; Path=/', location: '/' }); res.end(); return;
    }
    assert.equal(req.headers.cookie, 'dsh-auth-test=fixture');
    handle(req, res);
  });
  const sockets = new Set();
  origin.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  const proxy = new RemoteProxy({ origin: `http://127.0.0.1:${origin.address().port}`, tokenFile });
  const front = http.createServer((req, res) => proxy.forward(req, res));
  front.on('upgrade', (req, socket, head) => proxy.upgrade(req, socket, head));
  front.listen(0, '127.0.0.1'); await once(front, 'listening');
  t.after(async () => {
    proxy.close(); front.closeAllConnections(); origin.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(r => front.close(r)), new Promise(r => origin.close(r))]);
    await rm(dir, { recursive: true, force: true });
  });
  return { origin, proxy, front, tokenFile, url: `http://127.0.0.1:${front.address().port}` };
}

test('only loopback HTTP or fixed HTTPS origins are permitted', () => {
  for (const value of ['http://example.com:80', 'http://127.0.0.1:80/path', 'http://user:pass@127.0.0.1:3000', 'http://0.0.0.0:3000', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?token=secret', 'https://example.test/#fragment', 'ftp://example.test']) {
    assert.throws(() => validateOrigin(value));
  }
  assert.equal(validateOrigin('http://127.0.0.1:19381'), 'http://127.0.0.1:19381');
  assert.equal(validateOrigin('https://example.test'), 'https://example.test');
  assert.equal(validateOrigin('https://example.test:9443'), 'https://example.test:9443');
});

test('preserves body and binary response while replacing authentication', async t => {
  const bytes = Buffer.from([0, 255, 128, 42]);
  const f = await fixture(t, (req, res) => {
    assert.equal(req.url, '/api/sample/write?q=1');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.origin, undefined);
    let body = ''; req.on('data', b => body += b);
    req.on('end', () => {
      assert.equal(body, '{"sample":true}');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'set-cookie': 'must-not-leak=1' }); res.end(bytes);
    });
  });
  const result = await fetch(f.url + '/api/sample/write?q=1', {
    method: 'POST', headers: { cookie: 'local-cookie', authorization: 'local-secret', origin: 'http://local' }, body: '{"sample":true}',
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
});

test('unavailable backend returns failure and never succeeds locally', async t => {
  const f = await fixture(t, (_req, res) => res.end('remote'));
  await f.proxy.cookie();
  f.origin.closeAllConnections(); await new Promise(r => f.origin.close(r));
  const response = await fetch(f.url + '/api/sample/read');
  assert.equal(response.status, 502);
  assert.match(await response.text(), /No local fallback/);
});

test('refuses token files readable by other users', async t => {
  const f = await fixture(t, (_req, res) => res.end('should not happen'));
  await chmod(f.tokenFile, 0o644);
  assert.equal((await fetch(f.url + '/api/sample/read')).status, 502);
});

test('streams an authenticated upgrade bidirectionally', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => res.end());
  f.origin.on('upgrade', (req, socket, head) => {
    assert.equal(req.url, '/api/remote.mux');
    assert.equal(req.headers.cookie, 'dsh-auth-test=fixture');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', b => socket.write(b));
  });
  const socket = net.connect(f.front.address().port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write('GET /personal-remote/mux HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdGtleXRlc3RrZXkxMg==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  const [header] = await once(socket, 'data');
  assert.match(header.toString(), /101 Switching Protocols/);
  socket.write('stream-probe');
  const [reply] = await once(socket, 'data');
  assert.equal(reply.toString(), 'stream-probe');
  socket.destroy();
});

test('plugin protects the added upgrade route with DSH admission', () => {
  let route;
  const effects = [];
  const ctx = {
    effect: f => { effects.push(f()); }, on() {},
    webServer: { register: () => () => {}, registerUpgrade: r => { route = r; return () => {}; } },
    connection: { admit: () => ({ rejection: 403 }) },
  };
  apply(ctx, { origin: 'http://127.0.0.1:19381', tokenFile: '/not-read' });
  let response;
  route.handler({}, { end: text => response = text }, Buffer.alloc(0));
  assert.match(response, /403 Denied/);
  effects.forEach(f => f());
});


test('server-issued sessions survive a new proxy process without reusing a launch token', async t => {
  const f = await fixture(t, (_req,res) => res.end('ok'));
  const saved = { version:1, origin:f.proxy.origin, cookie:'dsh-auth-test=fixture', expiresAt:Date.now()+60000 };
  await writeFile(f.tokenFile, JSON.stringify(saved));
  const replacement = new RemoteProxy({ origin:f.proxy.origin, tokenFile:f.tokenFile });
  t.after(() => replacement.close());
  assert.equal(await replacement.cookie(), saved.cookie);
  assert.equal((await fetch(f.url+'/api/test')).status, 200);
});

test('stored sessions reject expiry, a different origin, and header injection', async t => {
  const f = await fixture(t, (_req,res) => res.end('must not reach'));
  const good = { version:1, origin:f.proxy.origin, cookie:'dsh-auth-test=fixture', expiresAt:Date.now()+60000 };
  for (const record of [{...good, expiresAt:0}, {...good, origin:'https://other.example'}, {...good,cookie:'dsh-auth-test=x\r\nInjected: true'}]) {
    await writeFile(f.tokenFile,JSON.stringify(record));
    const p = new RemoteProxy({origin:f.proxy.origin,tokenFile:f.tokenFile});
    await assert.rejects(p.cookie());p.close();
  }
});
