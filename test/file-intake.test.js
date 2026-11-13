import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installRemoteFileIntake } from '../routing.js';

class Transfer {
  constructor() {
    this.items = [];
    this.items.add = file => {
      const item = { kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null };
      this.items.push(item);
      return item;
    };
  }
  get files() { return this.items.filter(i => i.kind === 'file').map(i => i.getAsFile()); }
}
class Input {
  type = 'file';
  closest() { return {}; }
}
function fixture(selected = 'dev', native = true) {
  const events = {};
  const context = vm.createContext({ File, DataTransfer: Transfer, HTMLInputElement: Input,
    document: { addEventListener: (name, handler) => { events[name] = handler; } },
    __DSH_HOST_SWITCHER__: { selected },
    __DSH_HOST_PATHS__: native ? { pathFor: file => file.nativePath ?? '' } : undefined,
  });
  vm.runInContext(`(${installRemoteFileIntake.toString()})();`, context);
  return events;
}
const sourceFile = () => Object.assign(new File([new Uint8Array([0, 255, 42])], 'example.zip', {
  type: 'application/zip', lastModified: 1234,
}), { nativePath: '/client/private/example.zip' });

test('remote picker uploads detached file bytes while preserving filename and type', async () => {
  const handlers = fixture();
  const source = sourceFile(), input = new Input();
  input.files = [source];
  handlers.change({ target: input });
  const copy = input.files[0];
  assert.notEqual(copy, source);
  assert.equal(copy.nativePath, undefined);
  assert.equal(copy.name, source.name);
  assert.equal(copy.type, source.type);
  assert.equal(copy.lastModified, source.lastModified);
  assert.deepEqual(await copy.arrayBuffer(), await source.arrayBuffer());
});

test('drop and paste strip client paths; directory identity survives for DSH rejection', () => {
  for (const [eventType, field] of [['drop', 'dataTransfer'], ['paste', 'clipboardData']]) {
    const handlers = fixture(), source = new Transfer(), file = sourceFile();
    const item = source.items.add(file), directory = { isDirectory: true };
    item.webkitGetAsEntry = () => directory;
    const event = { [field]: source };
    handlers[eventType](event);
    assert.equal(event[field].files[0].nativePath, undefined);
    assert.equal(event[field].items[0].getAsFile(), event[field].files[0]);
    assert.equal(event[field].items[0].webkitGetAsEntry(), directory);
  }
});

test('Local, plain browser, and unrelated file inputs are unchanged', () => {
  assert.deepEqual(fixture('local'), {});
  assert.deepEqual(fixture('dev', false), {});
  const input = new Input(), files = [sourceFile()];
  input.files = files; input.closest = () => null;
  fixture().change({ target: input });
  assert.equal(input.files, files);
});
