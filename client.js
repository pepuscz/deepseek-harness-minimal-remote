window.__ModuleLoader__.load({
  id: '@pepuscz/dsh-ssh-connector',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function HostSwitcher() {
          const status = React.useSyncExternalStore(ctx.connection.state.subscribe, ctx.connection.state.getSnapshot);
          const config = globalThis.__DSH_HOST_SWITCHER__;
          const connected = status === 'connected';
          return h('div', {
            role: 'group', 'aria-label': 'Host connection',
            style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 8px 4px', fontSize: '12px', color: 'inherit' },
          },
            h('span', {
              role: 'status', 'aria-label': status ?? 'Connecting', title: status ?? 'Connecting',
              style: { flexShrink: 0, width: '6px', height: '6px', borderRadius: '50%', background: connected ? '#24a879' : '#d89b37' },
            }),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '2px', borderRadius: '7px', background: 'color-mix(in srgb, currentColor 6%, transparent)' } },
              ...config.hosts.map(host => h('button', {
                key: host.id, type: 'button', 'aria-pressed': config.selected === host.id,
                title: config.selected === host.id ? `${host.label} · ${status ?? 'connecting'}` : `Switch to ${host.label}. Running tasks stay on their host.`,
                onClick: () => config.switchTo(host.id),
                style: { font: 'inherit', lineHeight: '18px', fontWeight: config.selected === host.id ? 600 : 400,
                  padding: '2px 9px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                  color: config.selected === host.id ? '#365dc2' : 'inherit',
                  background: config.selected === host.id ? 'color-mix(in srgb, Canvas 88%, #6686e8 12%)' : 'transparent',
                },
              }, host.label))),
            !connected && h('button', {
              type: 'button', 'aria-label': 'Reconnect to current host', title: 'Reconnect',
              onClick: () => ctx.connection.reconnect(),
              style: { font: 'inherit', padding: '2px 4px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' },
            }, '↻'));
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'personal-remote-status', order: -50,
        }, HostSwitcher));
      },
    };
  },
});
