import { RemoteProxy } from './proxy.js';
import { HOST_HEADER, hostList, bootSwitcher } from './routing.js';

export const name = 'personal-remote-connector';
export const inject = ['webServer', 'connection'];

/** Compose public boot-injection, HTTP waterfall and upgrade-route APIs. No Gateway monkey patches. */
export function apply(ctx, config) {
  const hosts = hostList(config);
  const proxies = new Map(hosts.map(host => [host.id, new RemoteProxy(host)]));
  const defaultHost = config.hosts ? 'local' : 'remote';
  ctx.effect(() => () => { for (const proxy of proxies.values()) proxy.close(); });
  ctx.on('connection/request', (req, res, next) => {
    const id = req.headers[HOST_HEADER] ?? defaultHost;
    if (id === 'local') return next();
    const proxy = proxies.get(id);
    if (!proxy) { res.writeHead(400); res.end('Unknown DSH host. No local fallback.'); return; }
    return proxy.forward(req, res);
  });
  // Remote importer UI has a separate route family. Never run it on the local host.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api-import', handler: (req, res) => {
    const admission = ctx.connection.admit(req);
    if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('Denied'); return; }
    const id = req.headers[HOST_HEADER];
    const proxy = proxies.get(id);
    if (!proxy) { res.writeHead(400); res.end('Select a remote host to import sessions.'); return; }
    return proxy.forward(req, res);
  } }));
  // Dedicated namespace prevents local exact plugin routes from intercepting remote requests.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/personal-remote/http', handler: (req, res) => {
    const admission = ctx.connection.admit(req);
    if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('Denied'); return; }
    const match = /^\/personal-remote\/http\/([a-z][a-z0-9-]*)\/(api\/|api-import\/)/.exec(req.url);
    const proxy = match && proxies.get(match[1]);
    if (!proxy || req.headers[HOST_HEADER] !== match[1]) {
      res.writeHead(400); res.end('Invalid remote route. No local fallback.'); return;
    }
    req.url = req.url.slice(('/personal-remote/http/' + match[1]).length);
    return proxy.forward(req, res);
  } }));
  for (const [id, proxy] of proxies) ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/personal-remote/mux/' + id,
    handler: (req, socket, head) => {
      const admission = ctx.connection.admit(req);
      if ('rejection' in admission) {
        socket.end(`HTTP/1.1 ${admission.rejection} Denied\r\nConnection: close\r\n\r\n`);
        return;
      }
      return proxy.upgrade(req, socket, head);
    },
  }));
  ctx.on('webserver/index-inject', table => {
    const options = { defaultHost, hosts: [{ id: 'local', label: 'Local', description: 'This account' },
      ...hosts.map(({ id, label }) => ({ id, label, description: 'Remote host' }))] };
    table.push({ kind: 'script', placement: 'head', text:
      `(${bootSwitcher.toString()})(${JSON.stringify(options).replaceAll('<', '\\u003c')});` });
  });
}
