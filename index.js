import { RemoteProxy } from './proxy.js';

export const name = 'personal-remote-connector';
export const inject = ['webServer', 'connection'];

/** Compose public boot-injection, HTTP waterfall and upgrade-route APIs. No Gateway monkey patches. */
export function apply(ctx, config) {
  const proxy = new RemoteProxy(config);
  ctx.effect(() => () => proxy.close());
  ctx.on('connection/request', (req, res) => proxy.forward(req, res));
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/personal-remote/mux',
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
    table.push({ kind: 'global', name: '__PERSONAL_REMOTE_LABEL__', value: config.label });
    table.push({ kind: 'script', placement: 'head', text: `
      (() => {
        const transport = globalThis.__DSH_TRANSPORT__ ??= {};
        transport.createWebSocket = url => {
          const target = new URL(url);
          target.pathname = '/personal-remote/mux';
          return new WebSocket(target);
        };
      })();
    ` });
  });
}
