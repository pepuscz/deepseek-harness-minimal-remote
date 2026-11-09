window.__ModuleLoader__.load({
  id: '@pepuscz/dsh-ssh-connector',
  factory: require => {
    const React = require('react');
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function Status() {
          const status = React.useSyncExternalStore(ctx.connection.state.subscribe, ctx.connection.state.getSnapshot);
          return React.createElement('button', {
            title: 'Reconnect to the test host. Agent work belongs to the remote host.',
            onClick: () => ctx.connection.reconnect(),
            style: { font: 'inherit', padding: '8px', border: '1px solid #777', borderRadius: '8px', background: 'transparent', color: 'inherit' },
          }, `${globalThis.__PERSONAL_REMOTE_LABEL__} · ${status ?? 'connecting'}`);
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'personal-remote-status', order: -50,
        }, Status));
      },
    };
  },
});
