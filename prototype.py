#!/usr/bin/env python3
"""Launch isolated official DSH instances; keep logs/tokens outside the source tree."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.parse

ROOT = Path(__file__).resolve().parent
STATE = Path.home() / '.local/share/dsh-remote-prototype'
APP = Path('/Applications/DeepSeek Harness.app/Contents')
CLI = APP / 'Resources/runtime/cli/bin/dsh'
VERSION = '0.2.2-rc.1'

PATCH = '''
- id: desktop-product-telemetry
  disabled: true
- id: product-analytics
  disabled: true
- id: session-telemetry-otel
  disabled: true
'''

def environment(home):
    return dict(os.environ, DSH_HOME=str(home), DSH_TELEMETRY_DISABLED='1')

def private_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o600)

def start(command, env, logfile, cwd):
    with logfile.open('ab') as log:
        return subprocess.Popen(command, env=env, stdout=log, stderr=log, cwd=cwd, start_new_session=True)

def running(pidfile, expected):
    if not pidfile.exists():
        return False
    pid = int(pidfile.read_text())
    command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
    if command.returncode:
        return False
    if expected not in command.stdout:
        raise SystemExit('PID belongs to another process; refusing to act.')
    return pid

def stop():
    for name, expected in [('client-1', f'--user-data-dir={STATE}/electron-1'),
                           ('client-2', f'--user-data-dir={STATE}/electron-2'),
                           ('host', 'cli.js web --host 127.0.0.1 --port 19381 --no-open')]:
        pidfile = STATE / f'{name}.pid'
        pid = running(pidfile, expected)
        if pid:
            os.kill(pid, signal.SIGTERM)
            print(f'Stopped prototype {name}.')

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['host', 'client', 'stop'])
    parser.add_argument('--number', type=int, choices=[1, 2], default=1)
    parser.add_argument('--debug-port', type=int)
    args = parser.parse_args()
    if args.action == 'stop':
        stop()
        return
    STATE.mkdir(parents=True, exist_ok=True)
    installed = subprocess.check_output([str(CLI), '--version'], text=True).strip()
    if installed != VERSION:
        raise SystemExit(f'Expected DSH {VERSION}; got {installed}. Requalify before use.')
    artifact = APP / 'Resources/app.asar'
    with artifact.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    lock = ROOT / 'runtime-lock.json'
    if lock.exists() and json.loads(lock.read_text())['asarSha256'] != digest:
        raise SystemExit('Installed app bytes changed; requalify before use.')
    if not lock.exists():
        lock.write_text(json.dumps(dict(version=VERSION, asarSha256=digest), indent=2) + '\n')
    if args.action == 'host':
        if running(STATE / 'host.pid', 'cli.js web --host 127.0.0.1 --port 19381 --no-open'):
            print('Prototype host is already running.')
            return
        home = STATE / 'host'
        host_patch = home / 'profiles/web/cordis.patch.yml'
        if not host_patch.exists():
            private_write(host_patch, PATCH + '\n- id: workspace-controller\n  config:\n    documentsDirectory: ' + json.dumps(str(STATE / 'documents')) + '\n')
        workspace = STATE / 'workspace'
        workspace.mkdir(exist_ok=True)
        private_write(workspace / 'REMOTE_TEST.txt', 'This file belongs to the separate DSH test host.\n')
        logfile = STATE / 'host.log'
        private_write(logfile, '')
        process = start([str(CLI), 'web', '--host', '127.0.0.1', '--port', '19381', '--no-open'], environment(home), logfile, workspace)
        private_write(STATE / 'host.pid', str(process.pid))
        for _ in range(120):
            if process.poll() is not None:
                raise SystemExit('Test host exited; inspect the private host.log locally.')
            match = re.search(r'http://127\.0\.0\.1:19381/\?token=([^\s\x1b]+)', logfile.read_text(errors='replace'))
            if match:
                private_write(STATE / 'host-token', urllib.parse.unquote(match[1]))
                print(f'Test host started; pid {process.pid}, loopback port 19381. Token stored privately.')
                return
            time.sleep(0.5)
        raise SystemExit('Host readiness timed out; inspect the private host.log locally.')
    home = STATE / f'client-{args.number}'
    if running(STATE / f'client-{args.number}.pid', f'--user-data-dir={STATE}/electron-{args.number}'):
        print(f'Prototype desktop {args.number} is already running.')
        return
    profile = home / 'profiles/desktop'
    connector = {'origin': 'http://127.0.0.1:19381', 'tokenFile': str(STATE / 'host-token'), 'label': 'DSH test host'}
    if not (profile / 'cordis.patch.yml').exists():
        private_write(profile / 'cordis.patch.yml', PATCH + '\n- id: personal-remote-connector\n  config: ' + json.dumps(connector) + '\n')
    if not (profile / 'package.json').exists():
        private_write(profile / 'package.json', json.dumps({
            'name': 'dsh-profile-desktop', 'private': True, 'dependencies': {},
            'dsh': {'profile': {'bundles': ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}},
        }, indent=2) + '\n')
        private_write(profile / 'cordis.yml', '[]\n')
        private_write(profile / 'pnpm-workspace.yaml', 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    env = environment(home)
    subprocess.run([str(CLI), 'plugin', '--profile', 'desktop', 'add', f'link:{ROOT}'], env=env, check=True)
    # Electron's user-data-dir flag separates single-instance locks and browser storage.
    command = [str(APP / 'MacOS/DeepSeek Harness'), f'--user-data-dir={STATE / f"electron-{args.number}"}']
    if args.debug_port:
        if not 1024 <= args.debug_port <= 65535:
            raise SystemExit('Invalid test debugging port')
        command += [f'--remote-debugging-port={args.debug_port}', '--remote-debugging-address=127.0.0.1']
    process = start(command, env, STATE / f'client-{args.number}.log', ROOT)
    private_write(STATE / f'client-{args.number}.pid', str(process.pid))
    print(f'Isolated desktop {args.number} started; pid {process.pid}.')

if __name__ == '__main__':
    main()
