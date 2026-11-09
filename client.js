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
          const [expanded, setExpanded] = React.useState(false);
          const [pending, setPending] = React.useState(null);
          const current = config.hosts.find(host => host.id === config.selected);
          const connected = status === 'connected';
          const subtle = { fontSize: '11px', opacity: 0.7, lineHeight: 1.5 };
          const button = { font: 'inherit', color: 'inherit', cursor: 'pointer', borderRadius: '9px', border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', background: 'transparent' };
          return h('section', { 'aria-label': 'Host connection', style: { margin: '4px 10px 10px', fontSize: '13px', color: 'inherit' } },
            h('button', {
              type: 'button', 'aria-expanded': expanded, 'aria-label': `Host: ${current?.label ?? 'Unavailable'}. Change host`,
              onClick: () => { setExpanded(!expanded); setPending(null); },
              style: { ...button, width: '100%', padding: '11px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' },
            }, h('span', { 'aria-hidden': true, style: { fontSize: '18px' } }, config.selected === 'local' ? '⌂' : '⇄'),
              h('span', { style: { flex: 1 } },
                h('span', { style: { display: 'block', fontSize: '10px', letterSpacing: '0.08em', opacity: 0.6 } }, 'HOST'),
                h('strong', null, current?.label ?? 'Unavailable')),
              h('span', { title: status ?? 'Connecting', 'aria-label': status ?? 'Connecting', style: { width: '7px', height: '7px', borderRadius: '50%', background: connected ? '#24a879' : '#d89b37' } }),
              h('span', { 'aria-hidden': true }, expanded ? '⌃' : '⌄')),
            expanded && h('div', { style: { padding: '8px', marginTop: '5px', border: button.border, borderRadius: '11px', background: 'color-mix(in srgb, Canvas 96%, currentColor 4%)' }, onKeyDown: event => { if (event.key === 'Escape') { setExpanded(false); setPending(null); } } },
              ...config.hosts.map(host => h('button', {
                key: host.id, type: 'button', 'aria-pressed': config.selected === host.id,
                onClick: () => { if (host.id !== config.selected) setPending(host); },
                style: { ...button, width: '100%', padding: '9px', marginBottom: '4px', textAlign: 'left', borderColor: host.id === (pending?.id ?? config.selected) ? '#6686e8' : 'transparent', background: host.id === config.selected ? 'color-mix(in srgb, #6686e8 10%, transparent)' : 'transparent' },
              }, h('strong', null, host.label), config.selected === host.id && h('span', { style: { float: 'right' } }, '✓'),
                h('div', { style: subtle }, host.description))),
              pending ? h('div', { style: { padding: '7px 4px 0' } },
                h('p', { style: { ...subtle, margin: '0 0 8px' } }, 'Running tasks stay on their host. Send or save any draft before switching.'),
                h('button', { type: 'button', style: { ...button, width: '100%', padding: '8px', background: '#4263d5', color: '#fff', border: 'none' }, onClick: () => config.switchTo(pending.id) }, `Switch to ${pending.label}`))
              : h('div', { style: { ...subtle, padding: '5px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h('span', { role: 'status' }, connected ? 'Connected' : status ?? 'Connecting…'),
                h('button', { type: 'button', onClick: () => ctx.connection.reconnect(), style: { ...button, padding: '4px 7px', fontSize: '11px' } }, 'Reconnect'))));
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'personal-remote-status', order: -50,
        }, HostSwitcher));
      },
    };
  },
});
