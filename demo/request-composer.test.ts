import test from 'node:test';
import assert from 'node:assert/strict';
import { composerQuery, matchingCommands } from './request-composer.ts';
import { admitSourceFiles } from './request-source-ui.ts';
import { captureConversationVisual } from './request-chat-evidence.ts';
import { modelScopeFixture } from '../src/model-scope-fixture.ts';

test('composer detects model mentions at the caret without interpreting emails, URLs or paths', () => {
  assert.deepEqual(composerQuery('Move @office to the wall', 12), { kind: 'mention', start: 5, end: 12, text: 'office' });
  assert.deepEqual(composerQuery('/sc', 3), { kind: 'command', start: 0, end: 3, text: 'sc' });
  assert.equal(composerQuery('email person@example.com', 24), null);
  assert.equal(composerQuery('https://example.com', 19), null);
  assert.equal(composerQuery('/plans/ground.pdf', 17), null);
  assert.equal(composerQuery('Hello world', 11), null);
  assert.equal(composerQuery('First line\n@', 12)?.kind, 'mention');
});

test('slash discovery exposes local context actions without approving, applying or sending changes', () => {
  assert.deepEqual(matchingCommands('scope').map(action => action.id), ['scope']);
  assert.deepEqual(matchingCommands('files').map(action => action.id), ['files']);
  assert.deepEqual(matchingCommands('approve'), []);
  assert.deepEqual(matchingCommands('send'), []);
});

test('picked and pasted files use the same complete-batch limits and MIME admission', () => {
  const files = [new File(['# A room'], 'plan.md'), new File(['dimensions'], 'measurements.txt')];
  const admitted = admitSourceFiles(files, { count: 1, bytes: 200 });
  assert.deepEqual(admitted.map(file => file.mediaType), ['text/markdown', 'text/plain']);
  assert.equal(admitted[0]?.file, files[0]);
  assert.throws(() => admitSourceFiles(files, { count: 3, bytes: 0 }), /four/);
  assert.throws(() => admitSourceFiles(files, { count: 0, bytes: 12 * 1024 * 1024 }), /12 MiB/);
  assert.throws(() => admitSourceFiles([new File([], 'empty.txt')], { count: 0, bytes: 0 }), /1 byte/);
  assert.throws(() => admitSourceFiles([new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' })], { count: 0, bytes: 0 }), /6 MiB/);
  assert.throws(() => admitSourceFiles([...files, new File(['code'], 'run.exe', { type: 'application/octet-stream' })], { count: 0, bytes: 0 }));
  assert.equal(files.length, 2, 'A rejected batch must leave earlier inputs intact.');
});

test('multiple model references retain exact stable IDs and snapshot without editing the model', () => {
  const graph = modelScopeFixture(); const before = JSON.stringify(graph);
  const visual = captureConversationVisual({ graph, snapshot: { kind: 'accepted', revisionId: 'a'.repeat(64) }, view: '3d',
    selectedObjectIds: ['office-desk', 'main-bed', 'office-desk'], levelId: null, reference: null });
  assert.deepEqual(visual.selectedObjectIds, ['office-desk', 'main-bed']);
  assert.equal(visual.snapshot.revisionId, 'a'.repeat(64));
  assert.equal(JSON.stringify(graph), before);
  assert.throws(() => captureConversationVisual({ graph, snapshot: visual.snapshot, view: '3d', selectedObjectIds: ['missing-desk'], levelId: null, reference: null }), /absent/);
});
