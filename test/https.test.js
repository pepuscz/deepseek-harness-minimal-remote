import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteProxy } from '../proxy.js';

test('HTTPS verifies certificates and carries authenticated HTTP and WebSocket traffic', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-https-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem'), tokenFile = join(dir, 'token');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  await writeFile(tokenFile, 'fixture-token', { mode: 0o600 });
  const origin = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    if (req.url === '/?token=fixture-token') {
      res.writeHead(303, { 'set-cookie': 'dsh-auth-fixture=ok; Max-Age=1800; HttpOnly; Path=/', location: '/' }); res.end(); return;
    }
    assert.equal(req.headers.cookie, 'dsh-auth-fixture=ok');
    assert.equal(req.headers.authorization, undefined);
    res.end(Buffer.from([0, 255, 42]));
  });
  const sockets = new Set();
  origin.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  origin.on('upgrade', (req, socket) => {
    assert.equal(req.headers.cookie, 'dsh-auth-fixture=ok');
    assert.equal(req.url, '/api/remote.mux');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.on('data', data => socket.write(data));
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  t.after(() => { for (const s of sockets) s.destroy(); origin.close(); });
  const url = `https://localhost:${origin.address().port}`;
  const untrusted = new RemoteProxy({ origin: url, tokenFile });
  t.after(() => untrusted.close());
  await assert.rejects(untrusted.cookie());
  const source = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import net from 'node:net';
    import { once } from 'node:events';
    import { readFile } from 'node:fs/promises';
    import { RemoteProxy } from ${JSON.stringify(new URL('../proxy.js', import.meta.url).href)};
    const proxy = new RemoteProxy({ origin: process.env.TEST_ORIGIN, tokenFile: process.env.TEST_TOKEN_FILE });
    const front = http.createServer((req, res) => proxy.forward(req, res));
    front.on('upgrade', (req, socket, head) => proxy.upgrade(req, socket, head));
    front.listen(0, '127.0.0.1'); await once(front, 'listening');
    try {
      const response = await fetch('http://127.0.0.1:' + front.address().port + '/api/test', { headers: { authorization: 'local-secret' } });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 255, 42]));
      assert.equal(response.headers.get('set-cookie'), null);
      const saved = JSON.parse(await readFile(process.env.TEST_TOKEN_FILE, 'utf8'));
      assert.equal(saved.origin, process.env.TEST_ORIGIN);
      assert.ok(saved.expiresAt > Date.now());
      const pairedAgain = new RemoteProxy({ origin: process.env.TEST_ORIGIN, tokenFile: process.env.TEST_TOKEN_FILE });
      assert.equal(await pairedAgain.cookie(), saved.cookie); pairedAgain.close();
      const socket = net.connect(front.address().port, '127.0.0.1');
      await once(socket, 'connect');
      socket.write('GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n');
      const [handshake] = await once(socket, 'data');
      assert.match(handshake.toString(), /101 Switching Protocols/);
      socket.write('hello'); const [echo] = await once(socket, 'data'); assert.equal(echo.toString(), 'hello'); socket.destroy();
    } finally { proxy.close(); front.closeAllConnections(); front.close(); }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, TEST_ORIGIN: url, TEST_TOKEN_FILE: tokenFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let errors = ''; child.stderr.on('data', b => { errors += b; });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, errors);
});
