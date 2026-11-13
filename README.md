# DeepSeek Harness Minimal Remote

Connect the official DeepSeek Harness desktop app to a persistent private host, with a compact **Local / Remote** switcher in the same window.

This independent community plugin adds no npm dependencies and does not modify the DSH application. The desktop retains its local support process. Current native connection checks use DSH **0.2.2-rc.2**; check compatibility before upgrading DSH.

## Setup

For the pinned client and host composition, use [DSH Remote Essentials](https://github.com/pepuscz/dsh-remote-essentials).

Install this plugin only in the desktop client's profile. Run the DSH host in a dedicated OS account with access to selected project folders. Keep its application listener on loopback and provide a private HTTPS endpoint with a valid certificate. Configure that exact authority on the host using DSH's `--trusted-host` option.

Add the following to the desktop profile's `cordis.patch.yml`, then restart the app:

```yaml
- id: personal-remote-connector
  config:
    hosts:
      - id: remote
        label: Remote
        origin: https://development.example:19443
        tokenFile: /absolute/private/path/to/host-session
```

Labels and origins are configured here. Each host has its own sessions and workspace. Clicking a host reloads the same window; save drafts first. Running tasks stay on their host. Local is selected on app launch.

## File uploads

With a remote host selected, picking, dropping or pasting a file transfers its bytes to that host through the existing authenticated connection. Client filesystem paths are not sent as host file references. Local mode retains DSH's native behavior. Attachments remain drafts until you send the message; normal DSH limits and approvals apply. Zip folders before uploading: directory drops are rejected, not recursively shared.

Install this connector update on each desktop client; no public endpoint or server networking change is required. The custom upload carrier retains cancellation, but DSH currently does not provide byte-progress callbacks to that hook.

## Authentication

The credential file must belong to the desktop user and have mode `0600`. Provision an initial host launch token securely; never put it in Git or the profile patch. The connector exchanges it for a server-issued session and saves an origin-bound record in the same file. Sessions survive ordinary host and client restarts, but expiry or revocation requires re-pairing. The server's session lifetime is unchanged.

Credentials stay in the client's support process, outside the renderer. The server signing secret stays on the host. HTTPS certificate and hostname verification are mandatory. Plain HTTP is supported only at explicit `127.0.0.1` ports for local connections. Unknown hosts and failed requests never fall back to local execution.

## Architecture and boundaries

```text
Official DSH desktop → authenticated connector → private HTTPS → DSH host
                                                               → project files
                                                               → model provider
```

The connector uses DSH transport hooks for HTTP and WebSocket traffic, including the import companion's admitted route and DSH's dedicated binary-upload hook. It does not install a VPN, proxy service or SSH daemon. Network enrollment and server operation are separate responsibilities.

This is connectivity, not a sandbox or a multi-user authorization boundary. DSH approvals and OS account permissions remain authoritative. Native Finder, directory picking, browser automation and OS open/reveal actions may run on the client; do not assume they operate remotely. Cross-machine media, artifacts and concurrent-client behavior need further qualification.

## Development and security

```sh
node --test test/*.test.js
```

Tests cover routing, authentication, credential permissions and persistence, failure isolation, HTTP and WebSocket forwarding, and TLS certificate rejection. TLS tests require OpenSSL; runtime code does not.

There are no npm runtime or development dependencies or install lifecycle hooks. CI actions are pinned to full commits. Review updates and pin immutable revisions before deployment. See [DEPENDENCIES.md](DEPENDENCIES.md). A small dependency tree aids review; it is not a security certification.

Licensed under MIT. Independent of DeepSeek.
