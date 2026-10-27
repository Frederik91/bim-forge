import test from 'node:test';
import assert from 'node:assert/strict';
import { Check } from 'typebox/value';
import { RoomRepository } from './room-model.ts';
import { syntheticResidentialFixture } from './synthetic-residential-fixture.ts';
import { EvidencePinSchema, EvidenceReadSetSchema, EvidenceUseSchema, EvidenceUsesSchema,
  normalizedEvidenceValue, parseEvidenceEntry, parseEvidencePin, parseEvidenceReadSet, parseEvidenceUses } from './model-evidence.ts';
import type { EvidenceEntry, EvidenceUse } from './model-evidence.ts';
import { evidenceAnchor, evidenceApplicable, evidenceHash } from '../demo/project-evidence-store.ts';

test('claims preserve actual model parameter values and require distinct provenance', async () => {
  const fixture = syntheticResidentialFixture();
  const repository = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Evidence', snapshot: fixture.snapshot });
  const entry: EvidenceEntry = { id: 'claim', anchor: evidenceAnchor(repository, repository.head('main'), 'wall-living-kitchen'),
    property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
    assertion: { kind: 'assumed', value: { kind: 'length', value: 150, unit: 'mm' }, rationale: 'Synthetic assumption; not surveyed.', basis: [] } };
  assert.deepEqual(parseEvidenceEntry(entry), entry);
  const { target: originTarget, ...unboundAnchor } = entry.anchor;
  assert.deepEqual(originTarget, { kind: 'main' });
  assert.throws(() => parseEvidenceEntry({ ...entry, anchor: unboundAnchor }), /Invalid/);
  assert.equal(evidenceApplicable(repository, entry.anchor, repository.head('main')), true);
  assert.equal(evidenceApplicable(repository, { ...entry.anchor, bodyHash: '0'.repeat(64) }, repository.head('main')), false);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'measured', value: entry.assertion.kind === 'assumed' ? entry.assertion.value : null, citations: [] } }), /Invalid/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'inferred', value: { kind: 'length', value: .15, unit: 'm' }, rationale: 'No basis.', basis: [] } }), /Invalid/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'unknown', value: 1, reason: 'Not known.' } }), /Invalid/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'assumed', value: { kind: 'number', value: 150 }, rationale: 'Wrong kind.', basis: [] } }), /kind mismatch/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'resolution', candidateIds: ['a', 'b'], selectedEntryId: 'c', rationale: 'Invalid selection.' } }), /original candidate/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'assumed', value: { kind: 'boolean', value: true }, rationale: ' '.repeat(4096), basis: [] } }), /Invalid/);
  assert.throws(() => parseEvidenceEntry({ ...entry, assertion: { kind: 'measured', value: { kind: 'distance', value: 150, unit: 'mm' }, citations: [] } }), /Invalid/);
  assert.equal(evidenceHash(parseEvidenceEntry(entry)), evidenceHash({ assertion: entry.assertion, predecessor: null,
    property: entry.property, anchor: entry.anchor, id: entry.id }));
});

test('unit normalization compares metres/millimetres and seconds/minutes/hours without changing originals', () => {
  const mm = { kind: 'length', value: 150, unit: 'mm' } satisfies Parameters<typeof normalizedEvidenceValue>[0];
  assert.deepEqual(normalizedEvidenceValue(mm), normalizedEvidenceValue({ kind: 'length', value: .15, unit: 'm' }));
  assert.equal(mm.unit, 'mm');
  assert.deepEqual(normalizedEvidenceValue({ kind: 'duration', value: 1, unit: 'h' }), normalizedEvidenceValue({ kind: 'duration', value: 60, unit: 'min' }));
  for (const value of [{ kind: 'number', value: 2 }, { kind: 'angle', value: 90, unit: 'deg' },
    { kind: 'text', value: 'Unknown' }, { kind: 'boolean', value: true }] satisfies Parameters<typeof normalizedEvidenceValue>[0][]) {
    assert.deepEqual(normalizedEvidenceValue(value), value);
  }
});

test('review pins/read sets export strict serializable schemas and reject hidden fields/accessors/duplicates', () => {
  const pin = { entryId: 'claim', hash: 'a'.repeat(64) };
  assert.equal(Check(EvidencePinSchema, pin), true);
  assert.deepEqual(parseEvidencePin(JSON.parse(JSON.stringify(pin))), pin);
  const set = { version: 1, projectId: 'project', revisionId: 'b'.repeat(64), target: { kind: 'main' }, pins: [pin], subjects: [] };
  assert.equal(Check(EvidenceReadSetSchema, set), true);
  assert.deepEqual(parseEvidenceReadSet(JSON.parse(JSON.stringify(set))), set);
  const { target, ...unboundReadSet } = set;
  assert.deepEqual(target, { kind: 'main' });
  assert.throws(() => parseEvidenceReadSet(unboundReadSet), /Invalid/);
  assert.throws(() => parseEvidenceReadSet({ ...set, target: { kind: 'baseline', id: 'immutable' } }), /Invalid/);
  assert.throws(() => parseEvidenceReadSet({ ...set, pins: [pin, pin] }), /Invalid/);
  assert.throws(() => parseEvidenceReadSet({ ...set, hidden: true }), /Invalid/);
  let accessed = false;
  const getter = Object.defineProperty({}, 'entryId', { enumerable: true, get() { accessed = true; return 'claim'; } });
  assert.throws(() => parseEvidencePin(getter), /accessor/);
  assert.equal(accessed, false);
  assert.throws(() => parseEvidencePin({ ...pin, hash: 'bad' }), /Invalid/);
});

test('proposal evidence uses are bounded serializable choices with one readable rationale per logical subject', () => {
  const use: EvidenceUse = { pin: { entryId: 'chosen', hash: 'a'.repeat(64) },
    subject: { anchor: { projectId: 'project', revisionId: 'b'.repeat(64), entityId: 'wall', bodyHash: 'c'.repeat(64), target: { kind: 'main' } },
      property: { definitionId: 'geometry-thickness', valueKind: 'length' } }, rationale: 'Use the documented synthetic width for this design proposal.' };
  assert.equal(Check(EvidenceUseSchema, use), true);
  assert.equal(Check(EvidenceUsesSchema, [use]), true);
  assert.deepEqual(parseEvidenceUses(JSON.parse(JSON.stringify([use]))), [use]);
  assert.deepEqual(parseEvidenceUses([]), []);
  for (const rationale of ['', ' \n\t ', 'x'.repeat(4097)]) assert.throws(() => parseEvidenceUses([{ ...use, rationale }]), /Invalid/);
  assert.throws(() => parseEvidenceUses([{ ...use, hidden: true }]), /Invalid/);
  assert.throws(() => parseEvidenceUses([{ ...use, pin: { ...use.pin, hash: 'bad' } }]), /Invalid/);
  assert.throws(() => parseEvidenceUses([use, { ...use, rationale: 'Another logical choice.', pin: { ...use.pin, entryId: 'other' },
    subject: { ...use.subject, anchor: { ...use.subject.anchor, revisionId: 'd'.repeat(64), bodyHash: 'e'.repeat(64) },
      property: { ...use.subject.property, valueKind: 'number' } } }]), /one choice per logical subject/);
  const bounded = Array.from({ length: 32 }, (_, index): EvidenceUse => ({ ...use,
    pin: { ...use.pin, entryId: `choice-${index}` }, subject: { ...use.subject, anchor: { ...use.subject.anchor, entityId: `entity-${index}` } } }));
  assert.equal(parseEvidenceUses(bounded).length, 32);
  assert.throws(() => parseEvidenceUses([...bounded, { ...use, rationale: 'Overflow.' }]), /Invalid/);
  const parsed = parseEvidenceUses([use]); const first = parsed[0]; assert.ok(first);
  first.pin.entryId = 'mutated'; assert.equal(use.pin.entryId, 'chosen');
  let accessed = false;
  const accessor = Object.defineProperty({}, 'rationale', { enumerable: true, get() { accessed = true; return 'Hidden'; } });
  assert.throws(() => parseEvidenceUses([accessor]), /accessor/); assert.equal(accessed, false);
});
