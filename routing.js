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
    return nativeFetch(request, { ...init, headers });
  };
  globalThis.fetch = routeFetch;
  transport.fetch = routeFetch;
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
