import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoomRepository } from '../src/room-model.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import { VersionedProjectStore } from './versioned-project-store.ts';
import type { RepositoryReference } from './versioned-project-contract.ts';

function count(db: DatabaseSync, table: 'bodies' | 'revisions' | 'documents' | 'projects' | 'publications'): number {
  const row = db.prepare(`SELECT count(*) AS count FROM versioned_${table}`).get();
  if (!row || typeof row.count !== 'number') throw new Error('Missing count.');
  return row.count;
}
function initial(store: VersionedProjectStore, repo: RoomRepository): RepositoryReference {
  const reference = store.put(repo);
  store.publish({ projectId: repo.projectId, reference, expectedDocumentId: null, origin: 'created', requestId: null, decisionId: null });
  return reference;
}
function publish(store: VersionedProjectStore, reference: RepositoryReference, expected: RepositoryReference): void {
  store.publish({ projectId: reference.projectId, reference, expectedDocumentId: expected.documentId,
    origin: 'accepted', requestId: 'request-study', decisionId: 'decision-study' });
}
async function proposal(repo: RoomRepository, snapshot: ModelSnapshot, name = 'study'): Promise<RoomRepository> {
  return repo.proposeReviewedModel({ name, from: repo.head('main'), snapshot,
    review: { requestId: `request-${name}`, selectedObjectIds: ['door-entry'], instruction: 'Prepare the fixture change.',
      summary: 'Fixture changed.', rationale: 'Inspect durable reconstruction.', constraints: 'Retain stable identities.', uncertainty: 'Concept fixture.',
      worker: { provider: 'test', model: 'durable-store', responseIds: ['response-study'], usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
      toolCalls: [{ name: 'run_model_script', status: 'accepted', error: null }],
      scriptExecutions: [{ version: 1, executionId: 'execution-study', language: 'typescript', sourceSha256: 'a'.repeat(64),
        status: 'completed', disposition: 'proposal', validation: 'passed', contractSha256: 'b'.repeat(64), policyVersion: 'bim-model-v1',
        runtime: { packageVersion: '0.1.0', guestAbi: 2, bootstrapVersion: 3, artifactSha256: 'c'.repeat(64) },
        calls: [{ sequence: 1, method: 'model.previewRectangle', disposition: 'completed' }], diagnostic: null }],
      sources: [{ id: '00000000-0000-0000-0000-000000000001', name: 'plan.txt', mediaType: 'text/plain', byteLength: 12, sha256: 'd'.repeat(64) }],
      validator: 'room-graph-v1' } });
}
async function wider(repo: RoomRepository, width = 1.2, name = 'study'): Promise<RoomRepository> {
  const snapshot = structuredClone(repo.view(repo.head('main')).snapshot);
  const door = snapshot.entities.find((item) => item.type === 'Door');
  if (!door || door.type !== 'Door') throw new Error('Missing door fixture.');
  door.width = width; return proposal(repo, snapshot, name);
}

test('one-object edit stores one body and one sparse version, retaining portable hashes and order', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const original = initial(store, root);
  const before = { bodies: count(db, 'bodies'), revisions: count(db, 'revisions') };
  const proposed = await wider(root); const reference = store.put(proposed);
  assert.equal(count(db, 'bodies'), before.bodies + 1); assert.equal(count(db, 'revisions'), before.revisions + 1);
  const row = db.prepare('SELECT delta FROM versioned_revisions WHERE project_id = ? AND id = ?').get(root.projectId, proposed.head('study'));
  assert.ok(row); assert.equal(typeof row.delta, 'string');
  if (typeof row.delta !== 'string') throw new Error('Missing delta.');
  const patch: unknown = JSON.parse(row.delta);
  assert.ok(patch && typeof patch === 'object' && 'entities' in patch && 'relationships' in patch && 'entityOrder' in patch && 'relationshipOrder' in patch);
  assert.deepEqual(patch.relationships, []); assert.deepEqual(patch.entityOrder, []); assert.deepEqual(patch.relationshipOrder, []);
  assert.ok(Array.isArray(patch.entities)); assert.equal(patch.entities.length, 1);
  assert.equal(store.read(reference), proposed.serialize());
  assert.equal((await RoomRepository.restore(store.read(reference))).serialize(), proposed.serialize());
  assert.equal(store.read(original), root.serialize()); assert.deepEqual(store.current(root.projectId), original);
  assert.deepEqual(store.history({ projectId: root.projectId, before: null, limit: 50 }).entries.map((item) => item.revisionId), [root.root()]);
});

test('accepted branches, source/script evidence and imported timestamps survive reopen and paging', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'versioned-store-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'store.sqlite'); let db = new DatabaseSync(filename); let store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const first = await wider(root);
  const accepted = first.accept('study', { decisionId: 'decision-study', actor: 'human' });
  const earliest = Date.now(); const reference = store.put(accepted);
  store.publish({ projectId: root.projectId, reference, expectedDocumentId: null, origin: 'imported', requestId: null, decisionId: null });
  const latest = Date.now(); const savedCounts = [count(db, 'bodies'), count(db, 'revisions'), count(db, 'documents')];
  assert.deepEqual(store.put(accepted), reference); assert.deepEqual(savedCounts, [count(db, 'bodies'), count(db, 'revisions'), count(db, 'documents')]);
  db.close(); db = new DatabaseSync(filename); t.after(() => db.close()); store = new VersionedProjectStore(db);
  const restored = await RoomRepository.restore(store.read(reference)); assert.equal(restored.serialize(), accepted.serialize());
  assert.deepEqual(restored.reviews(), accepted.reviews()); assert.deepEqual(restored.branches(), accepted.branches());
  const page = store.history({ projectId: root.projectId, before: null, limit: 1 });
  assert.equal(page.entries.length, 1); assert.equal(page.nextCursor, accepted.head('main'));
  assert.equal(page.entries[0]?.origin, 'imported'); assert.equal(page.entries[0]?.requestId, null);
  const older = store.history({ projectId: root.projectId, before: page.nextCursor, limit: 1 });
  assert.deepEqual(older.entries.map((item) => item.revisionId), [root.root()]); assert.equal(older.nextCursor, null);
  for (const item of [...page.entries, ...older.entries]) assert.ok(item.recordedAt >= earliest && item.recordedAt <= latest);
});

test('deletion uses tombstones, relationship edits persist and sparse ordering reconstructs', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); store.put(root);
  const snapshot = structuredClone(root.view(root.root()).snapshot);
  snapshot.entities = snapshot.entities.filter((item) => item.type !== 'Door'); snapshot.relationships = [];
  const deleted = await proposal(root, snapshot, 'deleted'); const reference = store.put(deleted);
  assert.equal(count(db, 'bodies'), 6); assert.equal(store.read(reference), deleted.serialize());
  const row = db.prepare('SELECT delta FROM versioned_revisions WHERE project_id = ? AND id = ?').get(root.projectId, deleted.head('deleted'));
  assert.ok(row && typeof row.delta === 'string');
  const patch: unknown = JSON.parse(row.delta);
  assert.ok(patch && typeof patch === 'object' && 'entities' in patch && 'relationships' in patch && 'entityOrder' in patch);
  assert.deepEqual(patch.entities, [{ id: 'door-entry', body: null }]); assert.deepEqual(patch.relationships, [{ id: 'host-entry', body: null }]);
  assert.deepEqual(patch.entityOrder, []);
  const changed = structuredClone(root.view(root.root()).snapshot); changed.entities.reverse();
  const host = changed.relationships[0]; assert.ok(host); host.offset = 2.6;
  const moved = await proposal(root, changed, 'moved'); assert.equal(store.read(store.put(moved)), moved.serialize());
  assert.equal(count(db, 'bodies'), 7);
});

test('projects cannot read or publish another project document or use its history cursor', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const a = await RoomRepository.create('A'); const b = await RoomRepository.create('B'); const ar = initial(store, a); const br = initial(store, b);
  assert.throws(() => store.read({ projectId: a.projectId, documentId: br.documentId }), /missing/);
  assert.throws(() => store.publish({ projectId: a.projectId, reference: br, expectedDocumentId: ar.documentId, origin: 'accepted', requestId: null, decisionId: null }), /another project/);
  const proposed = await wider(b); const accepted = proposed.accept('study', { decisionId: 'decision-study', actor: 'human' });
  const next = store.put(accepted); publish(store, next, br);
  assert.throws(() => store.history({ projectId: a.projectId, before: accepted.head('main'), limit: 50 }), /cursor/);
  assert.deepEqual(store.list({ limit: 32 }).map((item) => item.name).sort(), ['A', 'B']);
  assert.throws(() => store.list({ limit: 33 }), /limit/); assert.throws(() => store.history({ projectId: a.projectId, before: null, limit: 51 }), /limit/);
  assert.throws(() => store.history({ projectId: 'unknown', before: null, limit: 1 }), /unknown project/);
});

test('CAS fences stale publication and shared connection outer rollback removes head and all writes', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const original = initial(store, root);
  const proposed = await wider(root); const accepted = proposed.accept('study', { decisionId: 'decision-study', actor: 'human' });
  db.exec('BEGIN'); const reference = store.put(accepted); publish(store, reference, original);
  assert.deepEqual(store.current(root.projectId), reference);
  assert.throws(() => publish(store, original, original), /CAS/); assert.deepEqual(store.current(root.projectId), reference);
  db.exec('ROLLBACK'); assert.deepEqual(store.current(root.projectId), original);
  assert.equal(count(db, 'revisions'), 1); assert.equal(count(db, 'documents'), 1); assert.equal(count(db, 'bodies'), 6);
  assert.throws(() => store.read(reference), /missing/);
  const persisted = store.put(accepted); publish(store, persisted, original); assert.deepEqual(store.current(root.projectId), persisted);
  const history = store.history({ projectId: root.projectId, before: null, limit: 50 });
  assert.equal(history.entries[0]?.origin, 'accepted'); assert.equal(history.entries[0]?.decisionId, 'decision-study');
});

test('corrupt bodies, deltas and manifests or missing bodies/parents fail closed', async (t) => {
  for (const corruption of ["UPDATE versioned_bodies SET body = '{}'", "UPDATE versioned_revisions SET delta = '{}'",
    "UPDATE versioned_documents SET manifest = '{}'", 'DELETE FROM versioned_bodies', 'DELETE FROM versioned_revisions WHERE parent_id IS NULL']) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
    const proposed = await wider(await RoomRepository.create()); const reference = store.put(proposed); db.exec(corruption);
    assert.throws(() => store.read(reference), /corruption|missing/);
  }
});

test('failed immutable write rolls back inserted bodies and preserves an enclosing transaction', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); initial(store, root); const proposed = await wider(root);
  db.exec("CREATE TABLE caller_state(value TEXT); BEGIN; INSERT INTO caller_state VALUES ('keep');");
  db.exec("CREATE TRIGGER refuse_document BEFORE INSERT ON versioned_documents BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  assert.throws(() => store.put(proposed), /injected failure/); assert.equal(count(db, 'bodies'), 6); assert.equal(count(db, 'revisions'), 1);
  assert.equal(db.prepare('SELECT value FROM caller_state').get()?.value, 'keep'); db.exec('COMMIT');
  assert.equal(db.prepare('SELECT value FROM caller_state').get()?.value, 'keep');
});
