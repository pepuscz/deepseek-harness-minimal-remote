import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';

const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

/** Only a loopback listener or an independently authenticated SSH forward is accepted. */
export function validateOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Connector origin must be http://127.0.0.1:<port> with no path or credentials');
  }
  return url.origin;
}

/** Credentials remain in the host process and are never injected into the renderer. */
export class RemoteProxy {
  constructor({ origin, tokenFile }) {
    this.origin = validateOrigin(origin);
    this.tokenFile = tokenFile;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
    this.connections = new Set();
  }

  async cookie() {
    if (!this.authentication) {
      this.authentication = this.authenticate().catch(error => { this.authentication = undefined; throw error; });
    }
    return this.authentication;
  }

  async authenticate() {
    const info = await stat(this.tokenFile);
    if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Host token must be an owner-only file owned by this user');
    const token = (await readFile(this.tokenFile, 'utf8')).trim();
    if (!token || token.length > 4096) throw new Error('Invalid host token file');
    const url = new URL('/', this.origin);
    url.searchParams.set('token', token);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const cookies = response.headers.getSetCookie();
    await response.body?.cancel();
    if (![302, 303].includes(response.status) || cookies.length !== 1 || !cookies[0].startsWith('dsh-auth-')) throw new Error('Remote DSH authentication failed');
    return cookies[0].split(';', 1)[0];
  }

  async forward(req, res) {
    try {
      const cookie = await this.cookie();
      if (res.destroyed) return;
      const target = new URL(req.url, this.origin);
      if (target.origin !== this.origin || !target.pathname.startsWith('/api/')) throw new Error('Unsupported remote path');
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (!hop.has(name) && !['host', 'cookie', 'origin', 'sec-fetch-site', 'authorization', 'x-dsh-remote-host'].includes(name)) headers[name] = value;
      }
      headers.cookie = cookie;
      const upstream = http.request(target, { method: req.method, headers, agent: this.agent }, response => {
        if (response.statusCode === 401) this.authentication = undefined;
        const output = {};
        for (const [name, value] of Object.entries(response.headers)) if (!hop.has(name) && name !== 'set-cookie') output[name] = value;
        res.writeHead(response.statusCode, output);
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      const cancel = () => upstream.destroy();
      req.once('aborted', cancel);
      res.once('close', cancel);
      upstream.once('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('Remote host unavailable. No local fallback.');
      });
      req.pipe(upstream);
    } catch {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Remote host authentication or connection failed. No local fallback.');
    }
  }

  async upgrade(req, socket, head) {
    try {
      const cookie = await this.cookie();
      if (socket.destroyed) return;
      const headers = {
        connection: 'Upgrade', upgrade: 'websocket', cookie,
        'sec-websocket-key': req.headers['sec-websocket-key'],
        'sec-websocket-version': req.headers['sec-websocket-version'],
      };
      for (const name of ['sec-websocket-protocol', 'sec-websocket-extensions']) if (req.headers[name]) headers[name] = req.headers[name];
      const upstream = http.request(new URL('/api/remote.mux', this.origin), { headers });
      socket.once('close', () => upstream.destroy());
      upstream.once('upgrade', (response, remote, remoteHead) => {
        this.connections.add(socket); this.connections.add(remote);
        const close = () => { this.connections.delete(socket); this.connections.delete(remote); socket.destroy(); remote.destroy(); };
        remote.once('error', close); socket.once('error', close);
        remote.once('close', close); socket.once('close', close);
        let reply = 'HTTP/1.1 101 Switching Protocols\r\n';
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          if (response.rawHeaders[i].toLowerCase() !== 'set-cookie') reply += `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`;
        }
        socket.write(reply + '\r\n');
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.pipe(remote); remote.pipe(socket);
      });
      upstream.once('response', response => {
        if (response.statusCode === 401) this.authentication = undefined;
        response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      });
      upstream.once('error', () => socket.destroy());
      upstream.end();
    } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); }
  }

  close() {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear(); this.agent.destroy(); this.authentication = undefined;
  }
}
