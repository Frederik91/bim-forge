import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import { evidenceCanonical } from '../src/model-evidence.ts';
import type { EvidenceEntry, EvidencePin, EvidenceSubject } from '../src/model-evidence.ts';
import { RequestSourceStore } from './request-source-store.ts';
import { ProjectEvidenceStore, evidenceAnchor, evidenceApplicable, evidenceHash } from './project-evidence-store.ts';

async function setup(t: TestContext, filename = ':memory:') {
  const db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
  t.after(() => { if (db.isOpen) db.close(); });
  const sources = new RequestSourceStore(db); const store = new ProjectEvidenceStore(db, sources);
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic evidence', snapshot: fixture.snapshot });
  const anchor = evidenceAnchor(repository, repository.head('main'), 'wall-living-kitchen');
  const bytes = Buffer.from(fixture.sources.plan.text);
  const source = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'synthetic-plan.txt', mediaType: 'text/plain', bytes,
    signal: new AbortController().signal });
  sources.retainProject(repository.projectId, source);
  const entry = (id: string, value = .15): EvidenceEntry => ({ id, anchor,
    property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
    assertion: { kind: 'measured', value: { kind: 'length', value, unit: 'm' },
      citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'Synthetic plan wall-living-kitchen. Not a survey.' }] } });
  const append = (value: EvidenceEntry, commandId = `cmd-${value.id}`, actor = 'engineer') => store.append({ repository, commandId, actor, entry: value });
  const subject: EvidenceSubject = { anchor, property: entry('shape').property };
  const freeze = (pins: EvidencePin[], subjects: EvidenceSubject[] = []) => store.freezeReadSet({ repository, revisionId: repository.head('main'), pins, subjects });
  return { db, sources, store, fixture, repository, source, bytes, entry, append, subject, freeze };
}

test('retained synthetic evidence survives request expiry and exposes an inspectable provenance delta without changing geometry', async t => {
  const { db, sources, store, repository, source, bytes, entry, append, freeze } = await setup(t);
  const before = repository.serialize();
  const measured = append(entry('survey'));
  const assumption: EvidenceEntry = { ...entry('assumption', .2), assertion: { kind: 'assumed', value: { kind: 'length', value: .2, unit: 'm' },
    rationale: 'Explicit synthetic conflicting assumption.', basis: [] } };
  const assumed = append(assumption);
  db.prepare('UPDATE request_source_blobs SET created_at=?').run(Date.now() - 25 * 60 * 60 * 1000);
  const restartedSources = new RequestSourceStore(db);
  assert.deepEqual(restartedSources.get(repository.projectId, source.id), { source, bytes });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_source_bindings').get()?.n, 0);
  const readSet = freeze([measured]);
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, false);
  const resolution = append({ ...entry('resolution'), assertion: { kind: 'resolution', candidateIds: ['survey', 'assumption'], selectedEntryId: 'survey',
    rationale: 'Engineer chose documented synthetic source; original assumption retained.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([measured, resolution]) }).ready, true);
  const closure = store.bundleClosure({ repository, pins: [resolution] });
  assert.equal(closure.complete, true);
  assert.deepEqual(closure.entries.map(item => ({ id: item.entry.id, kind: item.entry.assertion.kind })), [
    { id: 'resolution', kind: 'resolution' }, { id: 'survey', kind: 'measured' }, { id: 'assumption', kind: 'assumed' }]);
  assert.deepEqual(closure.sources, [source]); assert.ok(!evidenceCanonical(closure).includes('bytes'));
  assert.deepEqual(store.get({ projectId: repository.projectId, pin: assumed }).entry, assumption);
  assert.equal(repository.serialize(), before);
  assert.deepEqual(diffSnapshots(repository.view(repository.head('main')).snapshot, repository.view(repository.root()).snapshot), {
    entities: { added: [], removed: [], modified: [] }, relationships: { added: [], removed: [], modified: [] } });
  assert.deepEqual(sources.retained(repository.projectId, source.id), source);
});

test('corrections append with predecessor CAS; original claims and receipts remain immutable after advance', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const original = entry('original'); const pin = append(original);
  const corrected: EvidenceEntry = { ...entry('correction', .16), predecessor: pin };
  const correction = append(corrected);
  assert.deepEqual(append(original), pin);
  assert.deepEqual(append({ property: original.property, assertion: original.assertion, anchor: original.anchor, predecessor: null, id: original.id }), pin);
  assert.throws(() => append({ ...original, assertion: { kind: 'unknown', reason: 'Changed command payload.' } }), /payload or actor/);
  assert.throws(() => append(original, 'cmd-original', 'different-actor'), /payload or actor/);
  assert.throws(() => append({ ...entry('racing-correction'), predecessor: pin }), /CAS/);
  assert.deepEqual(store.get({ projectId: repository.projectId, pin }).entry, original);
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([correction]) }).ready, true);
  assert.equal(store.page({ projectId: repository.projectId }).entries.length, 2);
  const snapshot = repository.view(repository.root()).snapshot;
  const lostOriginalRevision = await RoomRepository.createProject({ projectId: repository.projectId, name: 'Same project new graph',
    snapshot: { ...snapshot, entities: snapshot.entities.map(entity => entity.id === original.anchor.entityId ? { ...entity, name: 'Changed anchor body' } : entity) } });
  assert.notEqual(lostOriginalRevision.root(), original.anchor.revisionId);
  assert.equal(evidenceApplicable(lostOriginalRevision, original.anchor, lostOriginalRevision.root()), false);
  assert.deepEqual(store.append({ repository: lostOriginalRevision, actor: 'engineer', commandId: 'cmd-original', entry: original }), pin);
});

test('absence and source/body applicability are frozen; unrelated subject facts preserve readiness', async t => {
  const { db, store, repository, entry, append, freeze, subject } = await setup(t);
  const absent = freeze([], [subject]);
  assert.equal(store.verifyReadSet({ repository, readSet: absent }).ready, true);
  append({ ...entry('unrelated'), anchor: evidenceAnchor(repository, repository.head('main'), 'door-living-kitchen') });
  assert.equal(store.verifyReadSet({ repository, readSet: absent }).ready, true);
  const pin = append(entry('new-fact'));
  assert.match(store.verifyReadSet({ repository, readSet: absent }).reasons.join(' '), /previously absent/);
  const reviewed = freeze([pin]);
  append(entry('contradiction', .18));
  const status = store.verifyReadSet({ repository, readSet: reviewed });
  assert.equal(status.ready, false); assert.match(status.reasons.join(' '), /conflict/);
  const refrozen = freeze([pin]);
  assert.match(store.verifyReadSet({ repository, readSet: refrozen }).reasons.join(' '), /conflict/);
  db.prepare('UPDATE request_source_blobs SET bytes=zeroblob(byte_length)').run();
  assert.equal(store.verifyReadSet({ repository, readSet: refrozen }).ready, false);
  assert.equal(store.bundleClosure({ repository, pins: [pin] }).complete, false);
});

test('equivalent engineering units are not conflicts; assumptions remain assumptions', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const m = append(entry('metres'));
  const mm = append({ ...entry('millimetres'), assertion: { kind: 'assumed', value: { kind: 'length', value: 150, unit: 'mm' },
    rationale: 'Same value; no promotion.', basis: [] } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([m, mm]) }).ready, true);
  assert.equal(store.get({ projectId: repository.projectId, pin: mm }).entry.assertion.kind, 'assumed');
});

test('inferred facts freeze their basis subjects and cannot hide a later basis contradiction', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const basis = append(entry('basis'));
  const inferred = append({ ...entry('inferred'), property: { definitionId: 'estimated-width', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: 2, unit: 'm' }, rationale: 'Synthetic derivation.', basis: [basis] } });
  const readSet = freeze([inferred]);
  assert.equal(readSet.subjects.length, 2);
  append(entry('basis-conflict', .2));
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, false);
});

test('sources require explicit same-project retention and exact hashes; stale native anchors are rejected', async t => {
  const { sources, store, repository, source, entry, append } = await setup(t);
  const upload = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'not-retained.txt', mediaType: 'text/plain',
    bytes: Buffer.from('unretained'), signal: new AbortController().signal });
  const cited = (id: string, sourceId: string, sha256 = source.sha256): EvidenceEntry => ({ ...entry(id),
    assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' }, citations: [{ sourceId, sha256, locator: 'Original input' }] } });
  assert.throws(() => append(cited('unretained', upload.id, upload.sha256)), /not retained/);
  assert.throws(() => append(cited('missing', randomUUID())), /not retained/);
  assert.throws(() => append(cited('hash-mismatch', source.id, '0'.repeat(64))), /hash mismatch/);
  assert.throws(() => append({ ...entry('bad-body'), anchor: { ...entry('x').anchor, bodyHash: '0'.repeat(64) } }), /anchor/);
  assert.throws(() => append({ ...entry('bad-revision'), anchor: { ...entry('x').anchor, revisionId: '0'.repeat(64) } }), /anchor/);
  const foreign = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Other project', snapshot: repository.view(repository.root()).snapshot });
  assert.throws(() => store.append({ repository: foreign, entry: entry('foreign'), commandId: 'cmd-foreign', actor: 'engineer' }), /anchor/);
  assert.throws(() => sources.retained(foreign.projectId, source.id), /not retained/);
  assert.throws(() => sources.retainProject(foreign.projectId, source), /Unknown/);
  const foreignSource = await sources.add({ projectId: foreign.projectId, id: randomUUID(), name: 'other-project.txt', mediaType: 'text/plain',
    bytes: Buffer.from('Private other project fact.'), signal: new AbortController().signal });
  sources.retainProject(foreign.projectId, foreignSource);
  assert.throws(() => append(cited('foreign-source', foreignSource.id, foreignSource.sha256)), /not retained/);
  const pin = append(entry('private'));
  assert.throws(() => store.get({ projectId: foreign.projectId, pin }), /Missing/);
  assert.equal(store.bundleClosure({ repository: foreign, pins: [pin] }).complete, false);
  assert.equal(store.verifyReadSet({ repository: foreign, readSet: store.freezeReadSet({ repository, revisionId: repository.root(), pins: [pin], subjects: [] }) }).ready, false);
});

test('native property kinds and changed body applicability cannot be forged; unchanged bodies remain applicable', async t => {
  const { store, repository, entry, append } = await setup(t);
  assert.throws(() => append({ ...entry('wrong-native-kind'), property: { definitionId: 'geometry-thickness', valueKind: 'number' },
    assertion: { kind: 'assumed', value: { kind: 'number', value: .15 }, rationale: 'Wrong engineering type.', basis: [] } }), /native parameter kind/);
  const doorAnchor = evidenceAnchor(repository, repository.root(), 'door-entry');
  const proposed = await repository.propose({ name: 'narrow-entry', from: repository.root(), doorWidthM: .95 });
  assert.equal(evidenceApplicable(proposed, doorAnchor, proposed.head('narrow-entry')), false);
  assert.equal(evidenceApplicable(proposed, entry('same-wall').anchor, proposed.head('narrow-entry')), true);
  assert.throws(() => store.freezeReadSet({ repository: proposed, revisionId: proposed.head('narrow-entry'), pins: [],
    subjects: [{ anchor: doorAnchor, property: { definitionId: 'geometry-width', valueKind: 'length' } }] }), /inapplicable/);
});

test('resolutions retain competing originals, conflict with contrary resolutions and do not cover new contradictions', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const a = append(entry('a')); append(entry('b', .2));
  const resolution: EvidenceEntry = { ...entry('resolution-a'), assertion: { kind: 'resolution', candidateIds: ['a', 'b'], selectedEntryId: 'a', rationale: 'Choose synthetic a.' } };
  const chosen = append(resolution);
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen]) }).ready, true);
  const contrary = append({ ...entry('resolution-b'), assertion: { kind: 'resolution', candidateIds: ['a', 'b'], selectedEntryId: 'b', rationale: 'Contrary choice.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen, contrary]) }).ready, false);
  const correctedResolution = append({ ...resolution, id: 'resolution-b-corrected', predecessor: contrary });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen, correctedResolution]) }).ready, true);
  append(entry('c', .25));
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([a, chosen]) }).ready, false);
  assert.equal(store.get({ projectId: repository.projectId, pin: contrary }).entry.assertion.kind, 'resolution');
});

test('unknown dependencies block readiness while explicit corrections preserve original unknown history', async t => {
  const { store, repository, entry, append, freeze } = await setup(t);
  const unknown = append({ ...entry('unknown'), assertion: { kind: 'unknown', reason: 'No observation available.' } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([unknown]) }).ready, false);
  const corrected = append({ ...entry('later-observation'), predecessor: unknown });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([corrected]) }).ready, true);
  assert.equal(store.get({ projectId: repository.projectId, pin: unknown }).entry.assertion.kind, 'unknown');
  const inference = append({ ...entry('inference-from-unknown'), property: { definitionId: 'derived-length', valueKind: 'length' },
    assertion: { kind: 'inferred', value: { kind: 'length', value: .15, unit: 'm' }, rationale: 'Unknown basis must stay visible.', basis: [unknown] } });
  assert.equal(store.verifyReadSet({ repository, readSet: freeze([inference]) }).ready, false);
});

test('two independent SQLite connections arbitrate predecessor CAS and command replay on one ledger', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-cas-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const filename = path.join(directory, 'race.sqlite');
  const { store, repository, entry, append } = await setup(t, filename);
  const original = append(entry('original'));
  const otherDb = new DatabaseSync(filename); t.after(() => otherDb.close());
  const other = new ProjectEvidenceStore(otherDb, new RequestSourceStore(otherDb));
  assert.deepEqual(other.get({ projectId: repository.projectId, pin: original }), store.get({ projectId: repository.projectId, pin: original }));
  const correction: EvidenceEntry = { ...entry('winner'), predecessor: original };
  const pin = append(correction);
  assert.throws(() => other.append({ repository, commandId: 'loser', actor: 'engineer', entry: { ...entry('loser'), predecessor: original } }), /CAS/);
  assert.deepEqual(other.append({ repository, commandId: 'cmd-winner', actor: 'engineer', entry: correction }), pin);
});

test('request read sets are immutable and atomic with parent writes, retention and command receipts', async t => {
  const { db, sources, store, repository, entry, append, freeze } = await setup(t);
  const pin = append(entry('durable')); const readSet = freeze([pin]);
  store.pinReadSet({ requestId: 'request', readSet }); store.pinReadSet({ requestId: 'request', readSet });
  assert.deepEqual(store.readPinned({ projectId: repository.projectId, requestId: 'request' }), readSet);
  assert.throws(() => store.pinReadSet({ requestId: 'request', readSet: freeze([]) }), /immutable/);
  const transient = await sources.add({ projectId: repository.projectId, id: randomUUID(), name: 'transient.txt', mediaType: 'text/plain', bytes: Buffer.from('transactional'), signal: new AbortController().signal });
  db.exec('BEGIN IMMEDIATE');
  sources.retainProject(repository.projectId, transient);
  const rolled = append(entry('rolled-back'));
  store.pinReadSet({ requestId: 'rolled-back-request', readSet: freeze([rolled]) });
  db.exec('ROLLBACK');
  assert.throws(() => sources.retained(repository.projectId, transient.id), /not retained/);
  assert.throws(() => store.get({ projectId: repository.projectId, pin: rolled }), /Missing/);
  assert.equal(store.readPinned({ projectId: repository.projectId, requestId: 'rolled-back-request' }), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_evidence_receipts WHERE command_id=?').get('cmd-rolled-back')?.n, 0);
  assert.deepEqual(append(entry('rolled-back')), rolled);
  db.exec(`CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON project_evidence_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END`);
  assert.throws(() => append(entry('failed-receipt')), /receipt failure/);
  assert.equal(store.page({ projectId: repository.projectId }).entries.some(item => item.entry.id === 'failed-receipt'), false);
  db.exec('DROP TRIGGER fail_receipt'); append(entry('failed-receipt'));
});

test('SQLite restart restores receipts, original source bytes and immutable read pins', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-199-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const filename = path.join(directory, 'evidence.sqlite');
  const { db, repository, source, bytes, entry, append, freeze } = await setup(t, filename);
  const original = entry('original'); const pin = append(original); const readSet = freeze([pin]);
  new ProjectEvidenceStore(db, new RequestSourceStore(db)).pinReadSet({ requestId: 'request', readSet });
  db.prepare('UPDATE request_source_blobs SET created_at=?').run(Date.now() - 48 * 60 * 60 * 1000);
  db.close();
  const reopened = new DatabaseSync(filename); t.after(() => reopened.close());
  const sources = new RequestSourceStore(reopened); const store = new ProjectEvidenceStore(reopened, sources);
  assert.deepEqual(sources.get(repository.projectId, source.id), { source, bytes });
  assert.deepEqual(store.readPinned({ projectId: repository.projectId, requestId: 'request' }), readSet);
  assert.equal(store.verifyReadSet({ repository, readSet }).ready, true);
  assert.deepEqual(store.append({ repository, entry: original, commandId: 'cmd-original', actor: 'engineer' }), pin);
  assert.throws(() => store.append({ repository, entry: { ...original, assertion: { kind: 'unknown', reason: 'different' } }, commandId: 'cmd-original', actor: 'engineer' }), /payload or actor/);
});

test('bounded indexed keyset paging and entry/project/pin caps reject overflow without hydration', async t => {
  const { db, store, repository, entry, append, freeze, subject } = await setup(t);
  const pins: EvidencePin[] = [];
  for (let i = 0; i < 256; i++) pins.push(append(entry(`entry-${i}`)));
  assert.throws(() => append(entry('overflow')), /256 entries or 4 MiB/);
  assert.equal(store.page({ projectId: repository.projectId, limit: 20 }).entries.length, 20);
  const found: string[] = []; let after = 0;
  for (let page = 0; page < 13; page++) {
    const value = store.page({ projectId: repository.projectId, after, limit: 20 });
    found.push(...value.entries.map(item => item.entry.id));
    if (value.next === null) break;
    after = value.next;
  }
  assert.equal(found.length, 256); assert.equal(new Set(found).size, 256);
  assert.throws(() => store.page({ projectId: repository.projectId, limit: 21 }), /limit/);
  assert.throws(() => store.page({ projectId: repository.projectId, after: -1 }), /cursor/);
  assert.equal(freeze(pins.slice(0, 32)).pins.length, 32);
  assert.throws(() => freeze(pins.slice(0, 33)), /32 pins/);
  assert.throws(() => freeze([], Array.from({ length: 33 }, () => subject)), /32 pins/);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT body FROM project_evidence_entries WHERE project_id=? AND entity_id=? AND property_id=? ORDER BY sequence LIMIT 257')
    .all(repository.projectId, subject.anchor.entityId, subject.property.definitionId);
  assert.match(JSON.stringify(plan), /project_evidence_subject/);
  const pagePlan = db.prepare('EXPLAIN QUERY PLAN SELECT body FROM project_evidence_entries WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT 21').all(repository.projectId, 0);
  assert.match(JSON.stringify(pagePlan), /project_evidence_page/);
});

test('UTF-8 byte admission and stored hashes detect oversized or corrupted facts', async t => {
  const { db, store, repository, source, entry, append } = await setup(t);
  const tooLarge: EvidenceEntry = { ...entry('too-large'), assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' },
    citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'ø'.repeat(4096) },
      { sourceId: source.id, sha256: source.sha256, locator: 'å'.repeat(4096) }] } };
  assert.throws(() => append(tooLarge), /16 KiB/);
  const pin = append(entry('intact'));
  const original = store.get({ projectId: repository.projectId, pin });
  assert.equal(pin.hash, evidenceHash(original.entry));
  db.prepare('UPDATE project_evidence_entries SET body=? WHERE id=?').run(evidenceCanonical({ ...original.entry, assertion: { kind: 'unknown', reason: 'tampered' } }), pin.entryId);
  assert.throws(() => store.get({ projectId: repository.projectId, pin }), /integrity/);
});

test('exact 16 KiB entry and 4 MiB project boundaries are admitted; one more UTF-8 byte or entry is refused', async t => {
  const { db, source, store, repository, entry, append } = await setup(t);
  const largeEntry = (index: number): EvidenceEntry => {
    const value: EvidenceEntry = { ...entry(`large-${index}`), property: { definitionId: `custom-evidence-${index}`, valueKind: 'length' },
      assertion: { kind: 'documented', value: { kind: 'length', value: .15, unit: 'm' }, citations: ['a'.repeat(4096), 'b'.repeat(4096), 'c'.repeat(4096), 'x']
        .map(locator => ({ sourceId: source.id, sha256: source.sha256, locator })) } };
    const remaining = 16 * 1024 - Buffer.byteLength(evidenceCanonical(value));
    assert.ok(remaining > 0 && remaining < 4096);
    if (value.assertion.kind !== 'documented') throw new Error('Expected documented test entry.');
    const final = value.assertion.citations.at(-1); assert.ok(final);
    final.locator += 'x'.repeat(remaining);
    assert.equal(Buffer.byteLength(evidenceCanonical(value)), 16 * 1024);
    return value;
  };
  const exact = largeEntry(0); append(exact);
  if (exact.assertion.kind !== 'documented') throw new Error('Expected documented test entry.');
  const locator = exact.assertion.citations.at(-1); assert.ok(locator); locator.locator += 'x';
  assert.throws(() => append(exact), /16 KiB/);
  for (let i = 1; i < 256; i++) append(largeEntry(i));
  assert.equal(db.prepare('SELECT SUM(byte_length) AS bytes FROM project_evidence_entries WHERE project_id=?').get(repository.projectId)?.bytes, 4 * 1024 * 1024);
  assert.throws(() => append(entry('one-too-many')), /256 entries or 4 MiB/);
  assert.equal(store.page({ projectId: repository.projectId, limit: 1 }).entries.length, 1);
});
