import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RoomRepository, identifier } from '../src/room-model.ts';
import { createMultiStoreyProject } from '../src/multi-storey-house.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import { VersionedProjectStore } from './versioned-project-store.ts';
import type { EvidenceReadSet } from '../src/model-evidence.ts';
import type { WritableDesignTarget } from '../src/design-targets.ts';
import type { RepositoryReference } from './versioned-project-contract.ts';

function count(db: DatabaseSync, table: 'bodies' | 'revisions' | 'documents' | 'reviews' | 'projects' | 'publications' | 'target_publications'): number {
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
  db.exec(`CREATE TRIGGER known_body_must_be_reused BEFORE INSERT ON versioned_bodies
    WHEN EXISTS(SELECT 1 FROM versioned_bodies WHERE hash = NEW.hash) BEGIN SELECT RAISE(ABORT, 'known body restaged'); END;
    CREATE TRIGGER known_revision_must_be_reused BEFORE INSERT ON versioned_revisions
    WHEN EXISTS(SELECT 1 FROM versioned_revisions WHERE project_id = NEW.project_id AND id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'known revision restaged'); END;`);
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
  assert.deepEqual(store.put(proposed), reference);
  assert.equal(count(db, 'bodies'), before.bodies + 1); assert.equal(count(db, 'revisions'), before.revisions + 1);
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
  for (let index = snapshot.entities.length - 1; index >= 0; index -= 1) if (snapshot.entities[index].type === 'Door') snapshot.entities.splice(index, 1);
  snapshot.relationships = [];
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
    "UPDATE versioned_documents SET manifest = '{}'", "UPDATE versioned_reviews SET body = '{}'", 'DELETE FROM versioned_reviews',
    'DELETE FROM versioned_bodies', 'DELETE FROM versioned_revisions WHERE parent_id IS NULL']) {
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

test('legacy repository documents and current multi-storey snapshot versions round-trip unchanged', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const state = root.persistence();
  const legacy = await RoomRepository.restore(JSON.stringify({ version: 1, projectId: state.projectId, name: state.name,
    revisions: state.revisions, branches: state.branches }));
  const oldReference = store.put(legacy); assert.equal(store.read(oldReference), legacy.serialize());
  assert.equal((await RoomRepository.restore(store.read(oldReference))).persistence().version, 1);
  const house = await createMultiStoreyProject('Snapshot version two'); const reference = store.put(house);
  const restored = await RoomRepository.restore(store.read(reference)); assert.equal(restored.serialize(), house.serialize());
  assert.equal(restored.view(restored.root()).snapshot.version, 2);
  const snapshot = structuredClone(house.view(house.root()).snapshot);
  const furnishing = snapshot.entities.find((item) => item.type === 'Furniture'); assert.ok(furnishing);
  furnishing.name = 'Recorded plant';
  const proposed = await proposal(house, snapshot); assert.equal(store.read(store.put(proposed)), proposed.serialize());
});

test('accepted history is root plus two applied revisions and never contains private proposals', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); let current = initial(store, root);
  const first = await wider(root, 1.2, 'first'); const second = await wider(root, 1, 'second');
  store.put(second);
  let accepted = await root.acceptFrom(first, 'first', { decisionId: 'decision-first', actor: 'human' });
  const firstAccepted = accepted.head('main'); let next = store.put(accepted); publish(store, next, current); current = next;
  const secondSnapshot = structuredClone(root.view(root.root()).snapshot);
  const host = secondSnapshot.relationships[0]; assert.ok(host); host.offset += .2;
  const independent = await proposal(root, secondSnapshot, 'independent'); store.put(independent);
  accepted = await accepted.acceptFrom(independent, 'independent', { decisionId: 'decision-second', actor: 'human' });
  next = store.put(accepted); publish(store, next, current);
  const history = store.history({ projectId: root.projectId, before: null, limit: 50 });
  assert.deepEqual(history.entries.map((entry) => entry.revisionId), [accepted.head('main'), firstAccepted, root.root()]);
  assert.ok(!history.entries.some((entry) => entry.revisionId === second.head('second') || entry.revisionId === independent.head('independent')));
  assert.deepEqual(history.entries[0]?.changedRelationshipIds, ['host-entry']);
  assert.deepEqual(history.entries[0]?.changedEntityIds, []);
  assert.throws(() => store.history({ projectId: root.projectId, before: independent.head('independent'), limit: 20 }), /cursor/);
  const reconstructed = await RoomRepository.restore(store.read(next)); assert.equal(reconstructed.serialize(), accepted.serialize());
});

test('a publication with a replacement root is refused even when the project ID matches', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const current = initial(store, root); const changed = await wider(root);
  const replacement = await RoomRepository.createProject({ projectId: root.projectId, name: root.name, snapshot: changed.view(changed.head('study')).snapshot });
  const other = store.put(replacement); assert.throws(() => publish(store, other, current), /ancestry/);
  assert.deepEqual(store.current(root.projectId), current);
});

test('failed head write rolls back its history inside a caller savepoint', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const current = initial(store, root);
  const proposed = await wider(root); const accepted = proposed.accept('study', { decisionId: 'decision-study', actor: 'human' });
  const reference = store.put(accepted);
  db.exec("SAVEPOINT caller; CREATE TRIGGER refuse_head BEFORE UPDATE ON versioned_projects BEGIN SELECT RAISE(ABORT, 'head failure'); END;");
  assert.throws(() => publish(store, reference, current), /head failure/);
  assert.deepEqual(store.current(root.projectId), current); assert.equal(count(db, 'publications'), 1);
  db.exec('ROLLBACK TO caller; RELEASE caller'); publish(store, reference, current);
  assert.equal(count(db, 'publications'), 2);
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }

test('a hash-valid but broken hosting graph is refused before read returns', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); store.put(root); const snapshot = root.view(root.root()).snapshot;
  const host = snapshot.relationships[0]; assert.ok(host); const invalidHost = { ...host, target: 'missing-wall' };
  const body = canonical(invalidHost); const bodyHash = hash(body);
  db.prepare('INSERT INTO versioned_bodies(hash, kind, body) VALUES (?, ?, ?)').run(bodyHash, 'relationship', body);
  const row = db.prepare('SELECT delta FROM versioned_revisions WHERE project_id = ? AND id = ?').get(root.projectId, root.root());
  assert.ok(row && typeof row.delta === 'string'); const patch: unknown = JSON.parse(row.delta);
  assert.ok(patch && typeof patch === 'object' && !Array.isArray(patch));
  const deltaText = canonical({ ...patch, relationships: [{ id: host.id, body: bodyHash }] });
  const revisionId = hash(canonical({ version: 1, parentId: null, snapshot: { ...snapshot, relationships: [invalidHost] } }));
  db.prepare('INSERT INTO versioned_revisions(project_id, id, parent_id, delta_hash, delta) VALUES (?, ?, NULL, ?, ?)')
    .run(root.projectId, revisionId, hash(deltaText), deltaText);
  const metadata = canonical({ version: 2, projectId: root.projectId, name: root.name, revisions: [revisionId],
    branches: [{ name: 'main', revisionId }], reviews: [] });
  const documentId = hash(metadata);
  db.prepare('INSERT INTO versioned_documents(project_id, id, manifest) VALUES (?, ?, ?)').run(root.projectId, documentId, metadata);
  assert.throws(() => store.read({ projectId: root.projectId, documentId }), /Hosting references/);
});

test('oversize typed persistence is refused before writes and preserves the accepted head', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const current = initial(store, root); const state = root.persistence();
  const before = [count(db, 'bodies'), count(db, 'revisions'), count(db, 'documents'), count(db, 'publications')];
  // Simulate a typed future repository mutator that omits a whole-document bound.
  const oversized = Object.freeze({ ...state, name: 'ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢'.repeat(90_000) });
  assert.ok(Buffer.byteLength(canonical(oversized)) > 256 * 1024);
  const invalid = new Proxy(root, { get(target, key): unknown {
    return key === 'persistence' ? () => oversized : Reflect.get(target, key);
  } });
  db.exec("CREATE TRIGGER no_body_write BEFORE INSERT ON versioned_bodies BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;");
  assert.throws(() => store.put(invalid), /256 KiB/);
  assert.deepEqual(store.current(root.projectId), current); assert.equal(store.read(current), root.serialize());
  assert.deepEqual([count(db, 'bodies'), count(db, 'revisions'), count(db, 'documents'), count(db, 'publications')], before);
});

test('oversize state arrays are refused before writes without raising portable limits', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const current = initial(store, root); const state = root.persistence();
  const revisions = Array.from({ length: 101 }, () => state.revisions[0]);
  const invalid = new Proxy(root, { get(target, key): unknown {
    return key === 'persistence' ? () => Object.freeze({ ...state, revisions }) : Reflect.get(target, key);
  } });
  assert.throws(() => store.put(invalid), /bounded collection/);
  assert.deepEqual(store.current(root.projectId), current); assert.equal(count(db, 'revisions'), 1);
  assert.equal(count(db, 'documents'), 1); assert.equal(store.read(current), root.serialize());
});

test('immutable review evidence is stored once across reference documents and acceptance', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const root = await RoomRepository.create(); const proposed = await wider(root); const reference = store.put(proposed);
  assert.equal(count(db, 'reviews'), 1);
  db.exec(`CREATE TRIGGER known_review_must_be_reused BEFORE INSERT ON versioned_reviews
    WHEN EXISTS(SELECT 1 FROM versioned_reviews WHERE project_id = NEW.project_id AND hash = NEW.hash)
    BEGIN SELECT RAISE(ABORT, 'known review restaged'); END;`);
  const alternate = await proposed.propose({ name: 'alternate', from: root.root(), doorWidthM: 1 });
  const alternateReference = store.put(alternate); assert.equal(count(db, 'reviews'), 1);
  assert.equal(store.read(alternateReference), alternate.serialize());
  const accepted = alternate.accept('study', { decisionId: 'decision-study', actor: 'human' });
  const acceptedReference = store.put(accepted); assert.equal(count(db, 'reviews'), 1);
  assert.equal(store.read(acceptedReference), accepted.serialize()); assert.equal(store.read(reference), proposed.serialize());
  assert.deepEqual((await RoomRepository.restore(store.read(acceptedReference))).reviews(), accepted.reviews());
  for (const row of db.prepare('SELECT manifest FROM versioned_documents').all()) {
    assert.equal(typeof row.manifest, 'string'); if (typeof row.manifest !== 'string') throw new Error('Missing manifest.');
    assert.ok(!row.manifest.includes('scriptExecutions')); assert.ok(!row.manifest.includes('sourceSha256')); assert.ok(!row.manifest.includes('worker'));
  }
  const row = db.prepare('SELECT body FROM versioned_reviews').get(); assert.ok(row && typeof row.body === 'string');
  assert.ok(row.body.includes('scriptExecutions')); assert.ok(!row.body.includes('"decision"'));
  assert.deepEqual(store.put(accepted), acceptedReference); assert.equal(count(db, 'reviews'), 1);
});


const targetMain = { kind: 'main' } satisfies WritableDesignTarget;
const targetKitchen = { kind: 'alternative', id: identifier('kitchen') } satisfies WritableDesignTarget;
const targetBedroom = { kind: 'alternative', id: identifier('bedroom') } satisfies WritableDesignTarget;

async function targetFixture(store: VersionedProjectStore): Promise<{ repository: RoomRepository; reference: RepositoryReference }> {
  const original = await RoomRepository.create(); const previous = initial(store, original);
  const repository = original.captureBaseline({ id: 'as-is', name: 'As-is', from: original.freezeDesignTarget(targetMain) })
    .forkAlternative({ id: 'kitchen', name: 'Kitchen', baselineId: 'as-is' })
    .forkAlternative({ id: 'bedroom', name: 'Bedroom', baselineId: 'as-is' });
  const reference = store.put(repository);
  store.publishMetadata({ projectId: repository.projectId, expectedDocumentId: previous.documentId, reference });
  return { repository, reference };
}

async function targetStudy(repository: RoomRepository, name: string, target: WritableDesignTarget, evidence?: EvidenceReadSet): Promise<RoomRepository> {
  const frozen = repository.freezeDesignTarget(target); const snapshot = structuredClone(repository.view(frozen.revisionId).snapshot);
  const door = snapshot.entities.find(item => item.type === 'Door'); assert.ok(door); door.name = name;
  return repository.proposeReviewedModel({ name, from: frozen.revisionId, target: frozen, snapshot,
    review: { requestId: `request-${name}`, selectedObjectIds: ['door-entry'], instruction: 'Prepare a target fixture.',
      summary: 'Rename entry.', rationale: 'Prove target authority.', constraints: 'Retain siblings.', uncertainty: 'Synthetic fixture.',
      worker: { provider: 'fixture', model: 'target-store', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'preview_furnishings', status: 'accepted', error: null }], validator: 'room-graph-v1', ...(evidence ? { evidence } : {}) } });
}

function publishTarget(store: VersionedProjectStore, repository: RoomRepository, previous: RepositoryReference,
  name: string, target: WritableDesignTarget, expectedTargetRevisionId: string): RepositoryReference {
  const reference = store.put(repository);
  store.publish({ projectId: repository.projectId, reference, expectedDocumentId: previous.documentId,
    target, expectedTargetRevisionId, origin: 'accepted', requestId: `request-${name}`, decisionId: `decision-${name}` });
  return reference;
}

test('target metadata publication adds only immutable references without a geometry publication row', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  assert.equal(count(db, 'revisions'), 1); assert.equal(count(db, 'publications'), 1);
  assert.equal(count(db, 'target_publications'), 1);
  assert.equal(store.current(repository.projectId)?.documentId, reference.documentId);
  assert.equal(store.acceptedHead(repository.projectId, targetKitchen), repository.root());
  assert.deepEqual(store.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 50 }),
    store.history({ projectId: repository.projectId, before: null, limit: 50 }));
  assert.throws(() => store.publishMetadata({ projectId: repository.projectId, reference, expectedDocumentId: reference.documentId }), /requires new/);
  const proposal = await targetStudy(repository, 'metadata-bypass', targetKitchen);
  const accepted = proposal.accept('metadata-bypass', { decisionId: 'decision-metadata-bypass', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const staged = store.put(accepted);
  assert.throws(() => store.publishMetadata({ projectId: repository.projectId, reference: staged, expectedDocumentId: reference.documentId }), /head changed|geometry or reviews/);
  assert.equal(store.current(repository.projectId)?.documentId, reference.documentId);
  assert.equal((await RoomRepository.restore(store.read(reference))).serialize(), repository.serialize());
});

test('target publication requires exact native decision, document and target CAS and preserves sibling heads', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  const frozen = repository.freezeDesignTarget(targetKitchen);
  const proposed = await targetStudy(repository, 'target-accept', targetKitchen);
  const accepted = proposed.accept('target-accept', { decisionId: 'decision-target-accept', actor: 'human' }, frozen);
  const staged = store.put(accepted);
  const input = { projectId: repository.projectId, reference: staged, expectedDocumentId: reference.documentId,
    target: targetKitchen, expectedTargetRevisionId: frozen.revisionId, origin: 'accepted', requestId: 'request-target-accept', decisionId: 'decision-target-accept' } satisfies Parameters<VersionedProjectStore['publish']>[0];
  assert.throws(() => store.publish({ ...input, expectedTargetRevisionId: 'a'.repeat(64) }), /target publication CAS/);
  assert.throws(() => store.publish({ ...input, decisionId: 'forged' }), /exact native/);
  assert.throws(() => store.publish({ ...input, requestId: 'forged' }), /exact native/);
  assert.throws(() => store.publish({ ...input, target: targetMain }), /sibling target head changed/);
  const pendingRef = store.put(proposed);
  assert.throws(() => store.publish({ ...input, reference: pendingRef }), /must advance/);
  assert.throws(() => store.publish({ projectId: repository.projectId, reference: staged, expectedDocumentId: reference.documentId,
    origin: 'accepted', requestId: 'request-target-accept', decisionId: 'decision-target-accept' }), /explicit target CAS/);
  store.publish(input);
  assert.equal(store.acceptedHead(repository.projectId), repository.root());
  assert.equal(store.acceptedHead(repository.projectId, targetBedroom), repository.root());
  assert.equal(store.acceptedHead(repository.projectId, targetKitchen), proposed.head('target-accept'));
  const history = store.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 1 });
  assert.equal(history.entries[0]?.decisionId, 'decision-target-accept'); assert.equal(history.entries[0]?.origin, 'accepted');
  assert.equal(history.nextCursor, proposed.head('target-accept'));
  assert.equal(store.history({ projectId: repository.projectId, target: targetKitchen, before: history.nextCursor, limit: 50 }).entries[0]?.origin, 'created');
  assert.throws(() => store.history({ projectId: repository.projectId, target: targetBedroom, before: proposed.head('target-accept'), limit: 50 }), /cursor/);
  assert.throws(() => store.publish(input), /CAS/);
  assert.equal((await RoomRepository.restore(store.read(staged))).review('target-accept').decision.status, 'accepted');
});

test('target staging and shared-connection rollback preserve all previous heads and metadata atomically', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store); const originalDocuments = count(db, 'documents');
  const proposed = await targetStudy(repository, 'rolled-back', targetKitchen);
  const accepted = proposed.accept('rolled-back', { decisionId: 'decision-rolled-back', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  db.exec('BEGIN');
  const staged = publishTarget(store, accepted, reference, 'rolled-back', targetKitchen, repository.root());
  assert.deepEqual(store.current(repository.projectId), staged);
  const nested = accepted.captureBaseline({ id: 'second-pin', name: 'Alternative pin', from: accepted.freezeDesignTarget(targetKitchen) })
    .forkAlternative({ id: 'nested', name: 'Nested', baselineId: 'second-pin' });
  const nestedRef = store.put(nested);
  store.publishMetadata({ projectId: repository.projectId, expectedDocumentId: staged.documentId, reference: nestedRef });
  db.exec('ROLLBACK');
  assert.deepEqual(store.current(repository.projectId), reference);
  assert.equal(store.acceptedHead(repository.projectId, targetKitchen), repository.root());
  assert.equal(count(db, 'documents'), originalDocuments); assert.equal(count(db, 'revisions'), 1);
  assert.throws(() => store.read(nestedRef), /missing/);
  assert.equal(store.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 50 }).entries.length, 1);
});

test('sibling publication races fail document CAS, then native reconciliation retains both heads across restart', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bim-target-restart-')); const filename = path.join(directory, 'targets.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(filename); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  const a = await targetStudy(repository, 'kitchen-race', targetKitchen); const b = await targetStudy(repository, 'bedroom-race', targetBedroom);
  const acceptedA = a.accept('kitchen-race', { decisionId: 'decision-kitchen-race', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const first = publishTarget(store, acceptedA, reference, 'kitchen-race', targetKitchen, repository.root());
  const staleB = b.accept('bedroom-race', { decisionId: 'decision-bedroom-race', actor: 'human' }, repository.freezeDesignTarget(targetBedroom));
  assert.throws(() => publishTarget(store, staleB, reference, 'bedroom-race', targetBedroom, repository.root()), /CAS/);
  const both = await acceptedA.acceptFrom(b, 'bedroom-race', { decisionId: 'decision-bedroom-race', actor: 'human' }, repository.freezeDesignTarget(targetBedroom));
  const final = publishTarget(store, both, first, 'bedroom-race', targetBedroom, repository.root()); db.close();
  const restartedDb = new DatabaseSync(filename); t.after(() => restartedDb.close()); const restarted = new VersionedProjectStore(restartedDb);
  const restored = await RoomRepository.restore(restarted.read(final));
  assert.equal(restored.review('kitchen-race').decision.status, 'accepted'); assert.equal(restored.review('bedroom-race').decision.status, 'accepted');
  assert.equal(restarted.acceptedHead(repository.projectId), repository.root());
  assert.equal(restarted.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 50 }).entries[0]?.decisionId, 'decision-kitchen-race');
  assert.equal(restarted.history({ projectId: repository.projectId, target: targetBedroom, before: null, limit: 50 }).entries[0]?.decisionId, 'decision-bedroom-race');
});


test('portable v3 import proves native alternative decisions and inherited history without a receipt ledger', async t => {
  const sourceDb = new DatabaseSync(':memory:'); t.after(() => sourceDb.close()); const source = new VersionedProjectStore(sourceDb);
  const { repository, reference } = await targetFixture(source);
  const proposal = await targetStudy(repository, 'portable-accepted', targetKitchen);
  const accepted = proposal.accept('portable-accepted', { decisionId: 'decision-portable-accepted', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const published = publishTarget(source, accepted, reference, 'portable-accepted', targetKitchen, repository.root());
  const portable = await RoomRepository.restore(source.read(published));
  const nested = portable.captureBaseline({ id: 'portable-pin', name: 'Portable pin', from: portable.freezeDesignTarget(targetKitchen) })
    .forkAlternative({ id: 'portable-fork', name: 'Portable fork', baselineId: 'portable-pin' });
  const destinationDb = new DatabaseSync(':memory:'); t.after(() => destinationDb.close()); const destination = new VersionedProjectStore(destinationDb);
  const imported = destination.put(nested);
  destination.publish({ projectId: nested.projectId, reference: imported, expectedDocumentId: null, origin: 'imported',
    requestId: null, decisionId: null, target: targetMain, expectedTargetRevisionId: null });
  assert.equal((await RoomRepository.restore(destination.read(imported))).review('portable-accepted').decision.status, 'accepted');
  const inherited = destination.history({ projectId: nested.projectId, target: { kind: 'alternative', id: identifier('portable-fork') }, before: null, limit: 50 });
  assert.equal(inherited.entries[0]?.decisionId, 'decision-portable-accepted');
  assert.equal(inherited.entries[0]?.origin, 'imported'); assert.equal(inherited.entries.length, 2);
  assert.equal(destination.acceptedHead(nested.projectId), repository.root());
});

test('accepting an already stored pending revision still records its target-local human publication', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const original = await RoomRepository.create();
  const repository = original.captureBaseline({ id: 'as-is', name: 'As-is', from: original.freezeDesignTarget(targetMain) })
    .forkAlternative({ id: 'kitchen', name: 'Kitchen', baselineId: 'as-is' });
  const proposed = await targetStudy(repository, 'already-stored', targetKitchen); const reference = store.put(proposed);
  store.publish({ projectId: repository.projectId, reference, expectedDocumentId: null, origin: 'imported', requestId: null, decisionId: null,
    target: targetMain, expectedTargetRevisionId: null });
  const revisions = count(db, 'revisions');
  const accepted = proposed.accept('already-stored', { decisionId: 'decision-already-stored', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  publishTarget(store, accepted, reference, 'already-stored', targetKitchen, repository.root());
  assert.equal(count(db, 'revisions'), revisions);
  assert.equal(store.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 50 }).entries[0]?.decisionId, 'decision-already-stored');
});

test('publication preserves exact historical human decisions and immutable baseline bodies', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  const a = await targetStudy(repository, 'history-a', targetKitchen);
  const first = a.accept('history-a', { decisionId: 'decision-history-a', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const firstRef = publishTarget(store, first, reference, 'history-a', targetKitchen, repository.root());
  const b = await targetStudy(first, 'history-b', targetBedroom);
  const both = b.accept('history-b', { decisionId: 'decision-history-b', actor: 'human' }, first.freezeDesignTarget(targetBedroom));
  const state = both.persistence(); assert.equal(state.version, 3);
  if (state.version !== 3) throw new Error('Expected target envelope.');
  const changed = await RoomRepository.restore(JSON.stringify({ ...state, reviews: state.reviews.map(review => review.proposalName === 'history-a'
    ? { ...review, decision: { ...review.decision, actor: 'forged-actor' } } : review) }));
  assert.throws(() => publishTarget(store, changed, firstRef, 'history-b', targetBedroom, repository.root()), /sibling human decision changed/);
  const relabeled = await RoomRepository.restore(JSON.stringify({ ...state, designTargets: { ...state.designTargets,
    baselines: state.designTargets.baselines.map(baseline => ({ ...baseline, name: 'Rewritten pin' })) } }));
  assert.throws(() => publishTarget(store, relabeled, firstRef, 'history-b', targetBedroom, repository.root()), /immutable baseline changed/);
  assert.deepEqual(store.current(repository.projectId), firstRef);
});


test('hash-valid v3 bundle with an externally claimed acceptance but pending native review fails closed', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  const proposal = await targetStudy(repository, 'bundle-proof', targetKitchen);
  const accepted = proposal.accept('bundle-proof', { decisionId: 'decision-bundle-proof', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const staged = store.put(accepted);
  const row = db.prepare('SELECT manifest FROM versioned_documents WHERE project_id=? AND id=?').get(repository.projectId, staged.documentId);
  assert.ok(row && typeof row.manifest === 'string'); const value: unknown = JSON.parse(row.manifest);
  assert.ok(value && typeof value === 'object' && 'reviews' in value && Array.isArray(value.reviews));
  const review: unknown = value.reviews[0]; assert.ok(review && typeof review === 'object');
  Object.assign(review, { decision: { status: 'pending', decisionId: null, actor: null } });
  const text = canonical(value); const documentId = hash(text);
  db.prepare('INSERT INTO versioned_documents(project_id,id,manifest) VALUES(?,?,?)').run(repository.projectId, documentId, text);
  assert.throws(() => store.read({ projectId: repository.projectId, documentId }), /native accepted review ancestry/);
  assert.equal(store.current(repository.projectId)?.documentId, reference.documentId);
});

test('identical sibling geometry retains distinct target-local review decisions in publication history', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store);
  const a = await targetStudy(repository, 'same-change', targetKitchen);
  const frozenB = repository.freezeDesignTarget(targetBedroom); const originalReview = a.review('same-change');
  const { requestId, proposalName, baseRevisionId, proposalRevisionId, decision, target, ...evidence } = originalReview;
  const b = await repository.proposeReviewedModel({ name: 'same-bedroom', from: frozenB.revisionId, target: frozenB,
    snapshot: a.view(a.head('same-change')).snapshot, review: { ...evidence, requestId: 'request-same-bedroom' } });
  assert.equal(a.head('same-change'), b.head('same-bedroom'));
  const acceptedA = a.accept('same-change', { decisionId: 'decision-same-change', actor: 'human' }, repository.freezeDesignTarget(targetKitchen));
  const firstRef = publishTarget(store, acceptedA, reference, 'same-change', targetKitchen, repository.root());
  const both = await acceptedA.acceptFrom(b, 'same-bedroom', { decisionId: 'decision-same-bedroom', actor: 'human' }, frozenB);
  publishTarget(store, both, firstRef, 'same-bedroom', targetBedroom, repository.root());
  assert.equal(store.history({ projectId: repository.projectId, target: targetKitchen, before: null, limit: 50 }).entries[0]?.decisionId, 'decision-same-change');
  assert.equal(store.history({ projectId: repository.projectId, target: targetBedroom, before: null, limit: 50 }).entries[0]?.decisionId, 'decision-same-bedroom');
});


test('changed-only documents hash native evidence pins before decisions and retain explicit external dependencies on restart', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const store = new VersionedProjectStore(db);
  const { repository, reference } = await targetFixture(store); const frozen = repository.freezeDesignTarget(targetKitchen);
  const evidence: EvidenceReadSet = { version: 1, projectId: repository.projectId, revisionId: frozen.revisionId,
    pins: [{ entryId: 'authoritative-entry', hash: 'a'.repeat(64) }], subjects: [] };
  const proposed = await targetStudy(repository, 'store-evidence', targetKitchen, evidence);
  const pendingReference = store.put(proposed); const countBefore = count(db, 'reviews');
  const accepted = proposed.accept('store-evidence', { decisionId: 'decision-store-evidence', actor: 'human' }, frozen);
  const published = publishTarget(store, accepted, reference, 'store-evidence', targetKitchen, repository.root());
  assert.equal(count(db, 'reviews'), countBefore);
  assert.deepEqual((await RoomRepository.restore(store.read(pendingReference))).review('store-evidence').evidence, evidence);
  const restored = await RoomRepository.restore(store.read(published));
  assert.deepEqual(restored.review('store-evidence').evidence, evidence);
  const state = restored.persistence(); assert.ok(state.version === 3);
  assert.deepEqual(state.externalDependencies, { evidence: 'external', sourceBytes: 'external' });
  const body = db.prepare('SELECT body FROM versioned_reviews').get(); assert.ok(body && typeof body.body === 'string');
  assert.ok(body.body.includes('authoritative-entry'));
});
