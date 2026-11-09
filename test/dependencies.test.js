// Dependency additions require an explicit review of this baseline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('dependency and lifecycle baseline remains minimal', () => {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'resolutions']) {
    assert.deepEqual(manifest[key] ?? {}, {}, `${key}: review new dependency and its transitive tree`);
  }
  for (const key of ['bundledDependencies', 'bundleDependencies']) {
    assert.deepEqual(manifest[key] ?? [], [], `${key}: vendored dependencies require review`);
  }
  assert.deepEqual(manifest.peerDependencies ?? {}, {});
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'pretest', 'posttest']) {
    assert.equal(manifest.scripts?.[hook], undefined, `${hook}: lifecycle hooks require review`);
  }
});
