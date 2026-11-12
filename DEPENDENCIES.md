# Dependency policy

No npm runtime, development, optional or bundled dependencies are currently needed.
Use Node built-ins, browser APIs, the Node test runner and the DSH-provided React.
Do not add a UI framework, icon library, HTTP client or build pipeline for convenience.

The remote plugin relies on DSH host services and its UI slots, with no npm peers.

New dependencies require a documented reason, alternatives considered, license and
maintenance review, transitive dependency and install-script inspection, and exact
version/integrity pinning in a committed lockfile. Never blindly update a lockfile.
Prefer no install lifecycle scripts. A lockfile and a clean audit are not proof of safety.

The dependency-baseline test rejects unreviewed manifest dependencies, peer-range
changes and common lifecycle hooks. It is a review guard, not a sandbox or a full
source scanner: new imports, vendored code, download scripts and workflow changes
still require review. GitHub Actions are pinned to full commits; update deliberately.
CI runs tests without npm install, so it does not fetch a dependency tree.

Production plugin snapshots remain pinned by Git commit and archive SHA-256.
Review upstream merges, run tests and verify the UI before promoting a snapshot.
DSH itself has its own dependency tree, outside this plugin policy.
