export const HOST_HEADER = 'x-dsh-remote-host';

export function hostList(config) {
  const hosts = config.hosts ?? [{ id: 'remote', label: config.label ?? 'Remote', origin: config.origin, tokenFile: config.tokenFile }];
  const ids = new Set(['local']);
  for (const host of hosts) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(host.id) || ids.has(host.id)) throw new Error('Invalid or duplicate host id');
    ids.add(host.id);
  }
  return hosts;
}

/** Selected client files have bytes, but their native paths have no meaning on a remote host. */
export function installRemoteFileIntake() {
  if (globalThis.__DSH_HOST_SWITCHER__?.selected === 'local' || !globalThis.__DSH_HOST_PATHS__) return;
  const copies = new WeakMap();
  const detach = file => {
    if (!copies.has(file)) copies.set(file, new File([file], file.name, { type: file.type, lastModified: file.lastModified }));
    return copies.get(file);
  };
  const transferFiles = source => {
    const target = new DataTransfer();
    for (const item of source.items) {
      if (item.kind !== 'file') {
        if (item.type) target.setData(item.type, source.getData(item.type));
        continue;
      }
      const file = item.getAsFile();
      if (!file) continue;
      const added = target.items.add(detach(file));
      // Preserve directory detection so DSH refuses a folder, rather than
      // uploading a zero-byte pseudo-file or sending an unusable local path.
      if (added && item.webkitGetAsEntry) Object.defineProperty(added, 'webkitGetAsEntry', {
        value: () => item.webkitGetAsEntry(),
      });
    }
    return target;
  };
  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.closest('[data-composer-card]') || !input.files?.length) return;
    const transfer = new DataTransfer();
    for (const file of input.files) transfer.items.add(detach(file));
    input.files = transfer.files;
  }, true);
  for (const [type, field] of [['drop', 'dataTransfer'], ['paste', 'clipboardData']]) {
    document.addEventListener(type, event => {
      const transfer = event[field];
      if (!transfer?.files.length) return;
      // Keep DSH's existing drop/paste handlers, validation and draft lifecycle.
      // Only remove the client filesystem identity from user-selected bytes.
      Object.defineProperty(event, field, { value: transferFiles(transfer) });
    }, true);
  }
}

// Runs before DSH's client modules. Selection is immutable for this page lifetime.
export function bootSwitcher(options) {
  const selected = new URL(location.href).searchParams.get('dshHost') ?? options.defaultHost;
  const known = options.hosts.some(host => host.id === selected);
  // Unknown selections are still stamped on requests and rejected by the host.
  // Throwing here would leave the unmodified local transport active.
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const transport = globalThis.__DSH_TRANSPORT__ ??= {};
  const previousSocket = transport.createWebSocket ?? (url => new WebSocket(url));
  const routeFetch = (input, init) => {
    const request = new Request(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href), input instanceof Request ? input : undefined);
    const url = new URL(request.url);
    const page = new URL(location.href);
    if (url.protocol !== page.protocol || url.host !== page.host || !(url.pathname.startsWith('/api/') || url.pathname.startsWith('/api-import/'))) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? request.headers);
    headers.set('x-dsh-remote-host', selected);
    if (selected !== 'local') {
      url.pathname = '/personal-remote/http/' + (known ? selected : '_unavailable') + url.pathname;
      return nativeFetch(new Request(url, request), { ...init, headers });
    }
    return nativeFetch(request, { ...init, headers });
  };
  globalThis.fetch = routeFetch;
  transport.fetch = routeFetch;
  // Blob/stream uploads otherwise use an isolated Worker (XHR/fetch), which
  // cannot see the page's selected-host routing. DSH exposes this pre-boot hook
  // for clients that own their transport. Keep Local's native carrier intact.
  if (selected !== 'local') globalThis.__DSH_FILE_UPLOAD__ = { fetch: routeFetch };
  transport.createWebSocket = url => {
    if (selected === 'local') return previousSocket(url);
    const target = new URL(url);
    target.pathname = '/personal-remote/mux/' + (known ? selected : '_unavailable');
    return new WebSocket(target);
  };
  globalThis.__DSH_HOST_SWITCHER__ = { ...options, selected,
    switchTo(id) {
      if (id === selected || !options.hosts.some(host => host.id === id)) return;
      // Full reload discards host-bound client caches and subscriptions.
      location.assign('/?dshHost=' + encodeURIComponent(id));
    },
  };
}
