# DeepSeek Harness Minimal Remote

A minimal, dependency-free plugin that connects the **official DeepSeek Harness desktop interface** to a separate persistent Harness host.

Use the existing conversation UI, file previews and approval controls while work and session history live on the host. No DSH fork, hosted coordination service or third-party remote plugin is required.

**Experimental macOS prototype.** Qualified with DSH **0.2.2-rc.1** on Apple Silicon. The included demo runs both ends locally with separate profiles. It does not yet manage SSH or establish OS-level isolation. This is an independent community project, not an official DeepSeek plugin. “Desktop” means the existing DSH application, not a new native UI toolkit.

## Small dependency footprint, easier security review

This plugin adds **no npm runtime or development dependencies**. It reuses Node/browser APIs and services already supplied by DSH, keeping the additional dependency tree small and the source easier to inspect.

- **No install lifecycle scripts.** CI runs tests without installing npm packages.
- **Dependency changes are visible.** Tests enforce the reviewed manifest baseline, including peer dependencies and common lifecycle hooks.
- **Pinned CI tooling.** GitHub Actions use full commit hashes instead of moving version tags.
- **Deliberate updates.** Our release policy requires reviewed Git snapshots and SHA-256 checksums before promotion.

These safeguards reduce supply-chain exposure; they are not a security certification or a sandbox. DSH and its own dependencies remain part of the trust boundary. See the [dependency and review policy](DEPENDENCIES.md).

## One desktop, multiple hosts

The plugin can now add a compact **Local / Development** switcher to your existing desktop profile. **Local** uses the original account and session store; each configured remote uses its own host and history. Click a host directly to reload the view in the same window—no menu or confirmation step. A small dot shows connection status; Reconnect appears only when disconnected. Save or send drafts first. Switching does not move sessions or stop host-side tasks. On app launch, Local is the default.

Install the plugin into the desktop profile using the bundled `dsh plugin --profile desktop add link:/absolute/path/to/this/repository`, then add this entry to that profile's `cordis.patch.yml` and restart the app:

```yaml
- id: personal-remote-connector
  config:
    hosts:
      - id: development
        label: Development
        origin: http://127.0.0.1:19391
        tokenFile: /absolute/private/path/to/host-token
```

Use a token file owned by the desktop user with mode `0600`. Never put tokens into the profile patch or this repository. The previous single `origin`/`tokenFile` configuration still works and starts on Remote.

The chosen host is captured for each page lifetime and stamped on same-origin API fetches; streaming uses a separate admitted route per host. In-flight requests retain their destination when switching. A full page reload resets in-memory session caches. Unknown hosts and failed remote connections never fall back to local execution. The native `dsh-app://` transport is supported without changing the installed app.

Qualified on the original macOS desktop: Local → Development → Local in one window, remote workspace/model controls, and restoration of local conversation history. This is still a connectivity plugin: native OS actions such as Finder, directory picking and browser automation may run on the client and are not qualified as remote operations. Media and artifact coverage remain incomplete.

## Quick start

Prerequisites: the matching official DSH macOS application installed in `/Applications`, Python 3.11+, and Node.js for the tests. `runtime-lock.json` pins the tested application's ASAR checksum. The launcher refuses mismatches; it never downloads or upgrades DSH.

```sh
git clone https://github.com/pepuscz/deepseek-harness-minimal-remote.git
cd deepseek-harness-minimal-remote
python3 prototype.py host
python3 prototype.py client --number 1
```

The separate desktop window shows **DSH test host · connected** in the sidebar. Configure your provider in the test window's model settings; those API requests address the test host. Your normal profile and credentials are not copied. Select the desired model and begin a test conversation.

To try a second client and reconnect to the same conversation:

```sh
python3 prototype.py client --number 2
```

The desktop clients can close while the independent host continues running. To stop the prototype without deleting history:

```sh
python3 prototype.py stop
```

`Start test.command` and `Stop test.command` are macOS launchers for the same operations. Runtime files live under `~/.local/share/dsh-remote-prototype`, outside this repository. The host binds to `127.0.0.1:19381`. Nothing starts at boot. The launcher preserves existing profile settings on subsequent starts.

## Architecture

```text
Official DSH desktop
  → plugin in an isolated desktop profile
  → authenticated HTTP + WebSocket forwarding
  → persistent DSH host on a fixed loopback endpoint
  → your chosen model provider
```

The connector uses DSH's boot-injection, transport-hook, admitted HTTP-waterfall and upgrade-route APIs. It does not monkey-patch private Gateway methods. The normal DSH RPC and streaming protocols remain in use. Both ends must use the same qualified DSH version.

The local Host process authenticates using an owner-only token file and keeps the resulting backend cookie out of the renderer. HTTP requests pass ordinary DSH admission first; the extra streaming route performs the same check. Backend errors never fall back to local API execution. Only an explicit `http://127.0.0.1:<port>` target is allowed.

The plugin configuration is a profile patch, generated by the demo launcher:

```yaml
- id: personal-remote-connector
  config:
    origin: http://127.0.0.1:19381
    tokenFile: /absolute/private/path/to/host-token
    label: Development host
```

For a future deployment, an independently authenticated SSH local forward can supply that loopback endpoint. SSH lifecycle management and secure remote token retrieval are not included or qualified yet. There is no public listener and no custom encryption protocol.

## Verified behavior

- Two official desktop instances displayed the same host workspace and conversation.
- A model-backed agent ran a command and read a fixture in the host workspace.
- The fixture opened in the desktop file preview.
- A running turn completed after both desktop clients closed; its result appeared after reconnecting.
- A pending approval survived client closure. Another client could reject it; the host respected the rejection and retained Workspace Write mode.
- Unauthenticated HTTP and streaming requests were refused.

Run the focused tests with:

```sh
node --test test/*.test.js
```

The tests cover target validation, credential handling, binary responses, backend failure, token-file permissions, bidirectional streaming and upgrade-route admission. `cdp.mjs` is a developer-only helper for explicitly enabled prototype debugging ports; normal launches do not enable debugging.

## Limits and next tests

- This plugin provides connectivity, not a sandbox. The demo runs with the current macOS user's permissions and retains DSH's session approval controls.
- Native directory picking, browser actions, drag/drop, OS open/reveal actions and signing tools still need qualification against a different machine. These may invoke client-local integrations.
- Media uploads, generated artifacts, model switching, session statistics and competing actions from concurrent clients need broader testing.
- Reboot recovery, locked-machine operation and internet transport are not qualified.
- The official desktop still starts a local support host, so it is not a zero-backend thin client.
- DSH is evolving quickly. Requalify API compatibility and authentication after any version change; a matching version string alone is insufficient.

Contributions that keep the connector small, preserve approvals and add reproducible tests are welcome. Licensed under MIT.
