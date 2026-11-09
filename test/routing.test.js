import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootSwitcher, hostList, HOST_HEADER } from '../routing.js';
import { apply } from '../index.js';

function page(host = 'dev') {
  const requests = [], sockets = [], navigations = [];
  const location = { href: `http://127.0.0.1:1234/?dshHost=${host}`, origin: 'http://127.0.0.1:1234', assign: value => navigations.push(value) };
  const context = vm.createContext({ URL, Request, Headers, location,
    fetch: (input, init) => { requests.push({ input, init }); return Promise.resolve('ok'); },
    WebSocket: class { constructor(url) { sockets.push(String(url)); } },
  });
  vm.runInContext(`(${bootSwitcher.toString()})(${JSON.stringify({ defaultHost: 'local', hosts: [{ id: 'local' }, { id: 'dev' }] })})`, context);
  return { context, requests, sockets, navigations, location };
}

test('host selection is captured per page and late requests cannot change destination', async () => {
  const p = page();
  await p.context.fetch('/api/read', { method: 'POST', body: 'payload' });
  assert.equal(p.requests[0].init.headers.get(HOST_HEADER), 'dev');
  p.context.__DSH_HOST_SWITCHER__.switchTo('local');
  p.location.href = 'http://127.0.0.1:1234/?dshHost=local';
  await p.context.fetch('/api/write');
  assert.equal(p.requests[1].init.headers.get(HOST_HEADER), 'dev');
  assert.deepEqual(p.navigations, ['/?dshHost=local']);
});

test('external requests are untouched and selected host cannot be overridden by caller', async () => {
  const p = page();
  await p.context.fetch('https://example.com/api/read');
  assert.equal(p.requests[0].init, undefined);
  await p.context.fetch('/api/write', { headers: { [HOST_HEADER]: 'local', 'content-type': 'application/json' }, body: '{}', method: 'POST' });
  assert.equal(p.requests[1].init.headers.get(HOST_HEADER), 'dev');
  assert.equal(p.requests[1].init.headers.get('content-type'), 'application/json');
  assert.equal(p.requests[1].init.body, '{}');
});

test('remote WebSockets select a host, local retains original transport', () => {
  for (const id of ['local', 'dev']) {
    const p = page(id);
    p.context.__DSH_TRANSPORT__.createWebSocket('ws://127.0.0.1:1234/api/remote.mux');
    assert.equal(p.sockets[0], id === 'local' ? 'ws://127.0.0.1:1234/api/remote.mux' : 'ws://127.0.0.1:1234/personal-remote/mux/dev');
  }
});

test('unknown hosts fail closed; local explicitly calls the existing DSH handler', async () => {
  let handler;
  const effects = [];
  apply({ effect: f => effects.push(f()), on: (name, f) => { if (name === 'connection/request') handler = f; },
    connection: {}, webServer: { register: () => () => {}, registerUpgrade: () => () => {} },
  }, { hosts: [{ id: 'dev', origin: 'http://127.0.0.1:19391', tokenFile: '/not-read' }] });
  let local = 0, code;
  const res = { writeHead: c => code = c, end() {} };
  await handler({ headers: { [HOST_HEADER]: 'local' } }, res, () => local++);
  assert.equal(local, 1);
  await handler({ headers: { [HOST_HEADER]: 'missing' } }, res, () => local++);
  assert.equal(code, 400); assert.equal(local, 1);
  const p = page('missing');
  await p.context.fetch('/api/write');
  assert.equal(p.requests[0].init.headers.get(HOST_HEADER), 'missing');
  effects.forEach(f => f());
});

test('host ids must be unique and cannot shadow local', () => {
  for (const id of ['local', '../dev', '', 'Dev']) assert.throws(() => hostList({ hosts: [{ id }] }));
  assert.throws(() => hostList({ hosts: [{ id: 'dev' }, { id: 'dev' }] }));
});

test('custom desktop scheme is routed and unknown host cannot traverse into local streaming', async () => {
  const p = page('../api/remote.mux');
  p.context.__DSH_TRANSPORT__.createWebSocket('ws://127.0.0.1:1234/api/remote.mux');
  assert.equal(p.sockets[0], 'ws://127.0.0.1:1234/personal-remote/mux/_unavailable');
  p.location.href = 'dsh-app://app/?dshHost=dev';
  p.location.origin = 'dsh-app://app';
  await p.context.fetch('/api/read');
  assert.equal(p.requests[0].init.headers.get(HOST_HEADER), '../api/remote.mux');
});

test('importer requests carry the selected remote host', async () => {
  const p = page('dev');
  await p.context.fetch('/api-import/history', { method: 'POST', body: '{}' });
  assert.equal(p.requests[0].init.headers.get(HOST_HEADER), 'dev');
});

test('importer route fails closed for unauthenticated, local and unknown hosts', async () => {
  let route, admission = { rejection: 401 };
  const effects = [];
  apply({ effect: f => effects.push(f()), on() {},
    connection: { admit: () => admission },
    webServer: { register: r => { if (r.path === '/api-import/') route = r; return () => {}; }, registerUpgrade: () => () => {} },
  }, { hosts: [{ id: 'dev', origin: 'http://127.0.0.1:19391', tokenFile: '/not-read' }] });
  let status;
  const res = { writeHead: c => { status = c; }, end() {} };
  await route.handler({ headers: { [HOST_HEADER]: 'dev' } }, res);
  assert.equal(status, 401);
  admission = { peer: {} };
  for (const id of ['local', 'unknown', undefined]) {
    await route.handler({ headers: { [HOST_HEADER]: id } }, res);
    assert.equal(status, 400);
  }
  effects.forEach(f => f());
});

 test('remote custom plugin routes bypass local exact routes while local URLs stay unchanged', async () => {
   for (const id of ['dev', 'local']) {
     const p = page(id);
     for (const path of ['/api/deepseek-usage?lang=en', '/api-import/history']) {
       await p.context.fetch(path, { method: 'POST', body: '{}' });
       const sent = p.requests.at(-1);
       assert.equal(new URL(sent.input.url).pathname, (id === 'dev' ? '/personal-remote/http/dev' : '') + path.split('?')[0]);
       assert.equal(sent.init.body, '{}');
     }
   }
 });
