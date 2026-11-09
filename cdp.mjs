// Test harness for the explicitly launched isolated desktop only.
import { readFileSync } from 'node:fs';
const port = Number(process.env.DSH_TEST_DEBUG_PORT ?? 19383);
if (![19383, 19384].includes(port)) throw new Error('Only isolated prototype debugging ports are permitted');
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find(p => p.type === 'page');
if (!page) throw new Error('No prototype desktop page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const expression = readFileSync(0, 'utf8');
const method = process.argv[2] ?? 'Runtime.evaluate';
const params = method === 'Runtime.evaluate' ? { expression, returnByValue: true, awaitPromise: true } : JSON.parse(expression);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 20000);
  socket.onmessage = event => {
    const result = JSON.parse(event.data);
    if (result.id !== 1) return;
    clearTimeout(timeout); resolve(result);
  };
  socket.send(JSON.stringify({ id: 1, method, params }));
});
socket.close();
console.log(JSON.stringify(result.result ?? result.error));
